import { describe, it, expect } from "vitest";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";

class Child extends Resource {
  @Export(t.i32) accessor value = 0;
}

class Parent extends Resource {
  @Export(t.i32) accessor count = 0;

  @Export(t.dynamic, [t.dynamic])
  echo(v: unknown): unknown {
    return v;
  }
}

describe("TypeDef server-answering (TypeDefIdsByNames / Query / LinkTypeDefs)", () => {
  it("resolves a batch of class names to their registered ids", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    await wh.open();
    // Register both types on the server warehouse before any connection uses them.
    const parentLocal = wh.getLocalTypeDefByType(Parent);
    const childLocal = wh.getLocalTypeDefByType(Child);

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    const ids = await client.getTypeDefIds(["Parent", "Child", "DoesNotExist"]);
    expect(ids).toEqual([parentLocal.id, childLocal.id]);

    client.close();
    await server.close();
  });

  it("Query replies with a resource's children, distinct from GetResourceIdByLink's bare id", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    await wh.put("sys/parent", new Parent());
    await wh.put("sys/parent/kid", new Child());
    await wh.open();

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    const children = await client.queryResources("sys/parent");
    expect(children).toHaveLength(1);
    const [id, link] = children[0];
    expect(typeof id).toBe("number");
    expect(link).toBe("sys/parent/kid");

    client.close();
    await server.close();
  });

  it("LinkTypeDefs replies with the TypeDef dependency closure for a resource", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    await wh.put("sys/parent", new Parent());
    await wh.open();

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);

    const defs = await client.fetchLinkedTypeDefs("sys/parent");
    expect(defs.length).toBeGreaterThanOrEqual(1);
    expect(defs.some((d) => d.name === "Parent")).toBe(true);

    client.close();
    await server.close();
  });
});
