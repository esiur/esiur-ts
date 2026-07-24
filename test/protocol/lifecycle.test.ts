import { describe, it, expect, vi } from "vitest";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";
import { Ruling } from "../../src/security/permissions/Ruling.js";
import type { IPermissionsManager } from "../../src/security/permissions/IPermissionsManager.js";
import { AsyncException } from "../../src/core/AsyncException.js";
import { ExceptionCode } from "../../src/core/ExceptionCode.js";

class Counter extends Resource {
  @Export(t.i32) accessor count = 0;
}

class AllowManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  readonly settings = undefined;
  applicable = vi.fn((): Ruling => Ruling.Allowed);
  initialize(): boolean {
    return true;
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("Resource lifecycle: Create / Delete / Move / Detach", () => {
  it("creates a resource remotely with initial property values", async () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowManager(), true);
    await wh.put("sys", new MemoryStore());
    await wh.open();
    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    const local = wh.getLocalTypeDefByType(Counter);
    const id = await client.createResource("sys/counter", local.id, new Map([[0, 42]]));

    const created = wh.getById(id) as unknown as Counter;
    expect(created).toBeDefined();
    expect(created.count).toBe(42);
    expect(created.instance!.link).toBe("sys/counter");

    client.close();
    await server.close();
  });

  it("deletes a resource, and a subsequent attach fails ResourceNotFound", async () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowManager(), true);
    await wh.put("sys", new MemoryStore());
    const counter = await wh.put("sys/counter", new Counter());
    await wh.open();
    const id = counter.instance!.id;
    const typeDef = wh.getTypeDef(Counter);

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    await client.deleteResource(id);
    expect(wh.getById(id)).toBeUndefined();
    expect(counter.instance).toBeUndefined();

    await expect(client.attach(id, typeDef)).rejects.toMatchObject({
      code: ExceptionCode.ResourceNotFound,
    } as Partial<AsyncException>);

    client.close();
    await server.close();
  });

  it("renames a resource", async () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowManager(), true);
    await wh.put("sys", new MemoryStore());
    const counter = await wh.put("sys/counter", new Counter());
    await wh.open();
    const id = counter.instance!.id;

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    await client.moveResource(id, "renamed");
    expect(counter.instance!.link).toBe("sys/renamed");

    client.close();
    await server.close();
  });

  it("detach stops notifications for that connection only, without affecting others", async () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowManager(), true);
    await wh.put("sys", new MemoryStore());
    const counter = await wh.put("sys/counter", new Counter());
    await wh.open();
    const id = counter.instance!.id;
    const typeDef = wh.getTypeDef(Counter);

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const clientA = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);
    const clientB = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    const resA = (await clientA.attach(id, typeDef)) as unknown as { count: number };
    const resB = (await clientB.attach(id, typeDef)) as unknown as { count: number };

    counter.count = 1;
    await waitFor(() => resA.count === 1 && resB.count === 1);

    await clientA.detach(id);

    counter.count = 2;
    await waitFor(() => resB.count === 2);
    await new Promise((r) => setTimeout(r, 100));
    expect(resA.count).toBe(1); // A never got the update after detaching

    clientA.close();
    clientB.close();
    await server.close();
  });
});
