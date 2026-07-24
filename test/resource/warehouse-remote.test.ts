import { describe, it, expect } from "vitest";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { EpConnection, EpConnectionContext } from "../../src/protocol/EpConnection.js";
import type { WarehouseRemoteGetOptions } from "../../src/resource/Warehouse.js";

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

  it("attaches automatically when no TypeDef is supplied, fetching it from the server", async () => {
    const serverWh = new Warehouse();
    await serverWh.put("sys", new MemoryStore());
    const greeter = await serverWh.put("sys/greeter", new RemoteGreeter());
    await serverWh.open();

    const server = await EpServer.listen({ port: 0, warehouse: serverWh });
    const clientWh = new Warehouse();

    // No TypeDef supplied here — this drives EpConnection.get's real
    // TypeDefByResourceId round trip (now answered server-side; see
    // EpConnection.ts's epRequestTypeDefByResourceId).
    const connection = await EpConnection.connect(`ws://127.0.0.1:${server.port}`, clientWh);

    const res = (await connection.get("sys/greeter")) as unknown as {
      visits: number;
      greet(name: string): PromiseLike<string>;
    };

    expect(res.visits).toBe(0);
    expect(await res.greet("Zaid")).toBe("Hello Zaid");
    expect(res.visits).toBe(1);
    expect(greeter.visits).toBe(1);

    connection.close();
    await server.close();
  });

  it("WebSocketUri overrides the socket target independently of the resource path", async () => {
    const serverWh = new Warehouse();
    await serverWh.put("sys", new MemoryStore());
    const greeter = await serverWh.put("sys/greeter", new RemoteGreeter());
    await serverWh.open();

    const server = await EpServer.listen({ port: 0, warehouse: serverWh });
    const clientWh = new Warehouse();
    const typeDef = serverWh.getTypeDef(RemoteGreeter);

    // Port 1 is not listening — resolving `sys/greeter` against a socket
    // dialed there would fail/hang. `path`'s host:port is only meant to seed
    // resource-path parsing here; the real dial must use `WebSocketUri`.
    const res = (await clientWh.get(`ep://127.0.0.1:1/sys/greeter`, {
      typeDef,
      webSocketUri: `ws://127.0.0.1:${server.port}`,
    })) as {
      connection: EpConnection;
      visits: number;
      greet(name: string): PromiseLike<string>;
    };

    expect(await res.greet("Nadia")).toBe("Hello Nadia");
    expect(greeter.visits).toBe(1);

    res.connection.close();
    await server.close();
  });

  it("also honors the .NET-style EpConnectionContext({ WebSocketUri }) shape", async () => {
    const serverWh = new Warehouse();
    await serverWh.put("sys", new MemoryStore());
    const greeter = await serverWh.put("sys/greeter", new RemoteGreeter());
    await serverWh.open();

    const server = await EpServer.listen({ port: 0, warehouse: serverWh });
    const clientWh = new Warehouse();
    const typeDef = serverWh.getTypeDef(RemoteGreeter);

    const contextOptions: WarehouseRemoteGetOptions = {
      typeDef,
      WebSocketUri: `ws://127.0.0.1:${server.port}`,
    };
    const context = new EpConnectionContext(contextOptions);

    const res = (await clientWh.get(`ep://127.0.0.1:1/sys/greeter`, context)) as {
      connection: EpConnection;
      visits: number;
      greet(name: string): PromiseLike<string>;
    };

    expect(await res.greet("Omar")).toBe("Hello Omar");
    expect(greeter.visits).toBe(1);

    res.connection.close();
    await server.close();
  });
});
