import { describe, it, expect } from "vitest";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";

class RemoteGreeter extends Resource {
  @Export(t.i32) accessor visits = 0;

  @Export(t.string, [t.string])
  greet(name: string): string {
    this.visits++;
    return `Hello ${name}`;
  }
}

describe("Warehouse remote EP get", () => {
  it("returns an EpConnection for a bare ep:// URL", async () => {
    const serverWh = new Warehouse();
    await serverWh.put("sys", new MemoryStore());
    await serverWh.open();

    const server = await EpServer.listen({ port: 0, warehouse: serverWh });
    const clientWh = new Warehouse();

    const result = await clientWh.get(`ep://127.0.0.1:${server.port}`);
    expect(result).toBeInstanceOf(EpConnection);
    expect((result as EpConnection).isConnected).toBe(true);

    (result as EpConnection).close();
    await server.close();
  });

  it("returns an attached remote proxy for ep://host/path when a TypeDef is supplied", async () => {
    const serverWh = new Warehouse();
    await serverWh.put("sys", new MemoryStore());
    const greeter = await serverWh.put("sys/greeter", new RemoteGreeter());
    await serverWh.open();

    const server = await EpServer.listen({ port: 0, warehouse: serverWh });
    const clientWh = new Warehouse();
    const typeDef = serverWh.getTypeDef(RemoteGreeter);

    const res = (await clientWh.get(`ep://127.0.0.1:${server.port}/sys/greeter`, typeDef)) as {
      connection: EpConnection;
      visits: number;
      greet(name: string): PromiseLike<string>;
    };

    expect(res.visits).toBe(0);
    expect(await res.greet("Mira")).toBe("Hello Mira");
    expect(res.visits).toBe(1);
    expect(greeter.visits).toBe(1);

    res.connection.close();
    await server.close();
  });
});
