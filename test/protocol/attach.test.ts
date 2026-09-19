import { describe, it, expect } from "vitest";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { EpResource, type RemotePropertyChange } from "../../src/protocol/EpResource.js";
import { WSocket } from "../../src/net/sockets/WSocket.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";
import type { AsyncReply } from "../../src/core/AsyncReply.js";
import type { TypeDef } from "../../src/resource/template.js";
import type { IPermissionsManager } from "../../src/security/permissions/IPermissionsManager.js";
import { Ruling } from "../../src/security/permissions/Ruling.js";

class AllowAllPermissionsManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  readonly settings = undefined;

  applicable(): Ruling {
    return Ruling.Allowed;
  }

  initialize(): boolean {
    return true;
  }
}

class HelloResource extends Resource {
  @Export(t.i32) accessor counts = 0;

  @Export(t.string, [t.string])
  sayHi(msg: string): string {
    this.counts++;
    return `Welcome, ${msg}`;
  }
}

class ChildResource extends Resource {
  @Export(t.string) accessor label = "";
}

class ParentResource extends Resource {
  @Export(t.resource) accessor child: Resource | null = null;
}

class GeneratedHelloResource extends EpResource {
  static typeDef: TypeDef;

  get counts(): number {
    return this.GetResourceProperty<number>(0);
  }

  set counts(value: number) {
    this.SetResourceProperty(0, value);
  }

  sayHi(msg: string): AsyncReply<string> {
    return this._Invoke(0, new Map<number, unknown>([[0, msg]])) as AsyncReply<string>;
  }
}

describe("EpConnection attach + proxy + notifications (TS ↔ TS)", () => {
  it("gives a live remote proxy whose cached property tracks server changes", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    const hello = await wh.put("sys/hello", new HelloResource());
    await wh.open();
    const helloId = hello.instance!.id;
    const typeDef = wh.getTypeDef(HelloResource); // the client "knows" the TypeDef (generated stub)

    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.on("listening", () => r()));
    const port = (wss.address() as { port: number }).port;
    wss.on("connection", (raw: WsWebSocket) => {
      const sc = new EpConnection();
      sc.warehouse = wh;
      sc.assign(new WSocket(raw as unknown as WebSocket));
    });

    const client = new EpConnection();
    const sock = new WSocket();
    client.assign(sock);
    await sock.connect(`ws://127.0.0.1:${port}`);

    // attach → dynamic proxy primed with current property values
    const res = (await client.attach(helloId, typeDef)) as Record<string, unknown> & {
      counts: number;
      sayHi: (m: string) => PromiseLike<string>;
      propertyModified: { add(cb: (c: RemotePropertyChange) => void): void };
    };
    expect(res.counts).toBe(0);

    // invoke remotely; the server-side change pushes a notification that updates the cache
    expect(await res.sayHi("Ahmed")).toBe("Welcome, Ahmed");
    await waitFor(() => res.counts === 1);
    expect(res.counts).toBe(1);
    expect(hello.counts).toBe(1);

    // subsequent changes raise the proxy's propertyModified
    let lastChange: RemotePropertyChange | undefined;
    res.propertyModified.add((c) => (lastChange = c));
    expect(await res.sayHi("Bob")).toBe("Welcome, Bob");
    await waitFor(() => res.counts === 2);
    expect(res.counts).toBe(2);
    expect(lastChange).toMatchObject({ name: "counts", value: 2 });

    client.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("can attach using a generated EpResource subclass with indexed helpers", async () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowAllPermissionsManager(), true);
    await wh.put("sys", new MemoryStore());
    const hello = await wh.put("sys/hello", new HelloResource());
    await wh.open();
    const helloId = hello.instance!.id;
    GeneratedHelloResource.typeDef = wh.getTypeDef(HelloResource);

    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.on("listening", () => r()));
    const port = (wss.address() as { port: number }).port;
    wss.on("connection", (raw: WsWebSocket) => {
      const sc = new EpConnection();
      sc.warehouse = wh;
      sc.assign(new WSocket(raw as unknown as WebSocket));
    });

    const client = new EpConnection();
    const sock = new WSocket();
    client.assign(sock);
    await sock.connect(`ws://127.0.0.1:${port}`);

    const res = await client.attach(helloId, GeneratedHelloResource);
    expect(res).toBeInstanceOf(GeneratedHelloResource);
    expect(res.counts).toBe(0);
    expect(await res.sayHi("Generated")).toBe("Welcome, Generated");
    await waitFor(() => res.counts === 1);
    expect(res.counts).toBe(1);

    res.counts = 5;
    await waitFor(() => hello.counts === 5 && res.counts === 5);

    client.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("resolves resource-valued property notifications before publishing them", async () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowAllPermissionsManager(), true);
    await wh.put("sys", new MemoryStore());
    const first = await wh.put("sys/first", new ChildResource());
    first.label = "first";
    const second = await wh.put("sys/second", new ChildResource());
    second.label = "second";
    const parent = await wh.put("sys/parent", new ParentResource());
    await wh.open();
    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    const proxy = (await client.attach(
      parent.instance!.id,
      wh.getTypeDef(ParentResource),
    )) as EpResource & { child: (EpResource & { label: string }) | null };
    expect(proxy.child).toBeNull();

    const seen: string[] = [];
    proxy.propertyModified.add((change) => {
      const child = change.value as (EpResource & { label?: string }) | null;
      if (child?.label) seen.push(child.label);
    });
    parent.child = first;
    parent.child = second;

    await waitFor(() => seen.length === 2);
    expect(seen).toEqual(["first", "second"]);
    expect(proxy.child).toBeInstanceOf(EpResource);
    expect(proxy.child?.label).toBe("second");

    client.close();
    await server.close();
    await wh.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}
