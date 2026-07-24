import { describe, it, expect } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import { EpServer } from "../../src/protocol/EpServer.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";

class Greeter extends Resource {
  @Export(t.i32) accessor visits = 0;

  @Export(t.string, [t.string])
  greet(name: string): string {
    this.visits++;
    return `Hi ${name}`;
  }
}

describe("EpServer + EpConnection.connect (end-to-end API)", () => {
  it("hosts a warehouse and serves a remote client", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    const greeter = await wh.put("sys/greeter", new Greeter());
    await wh.open();

    const server = await EpServer.listen({ port: 0, warehouse: wh });
    const typeDef = wh.getTypeDef(Greeter);
    const greeterId = greeter.instance!.id;

    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`);
    const res = (await client.attach(greeterId, typeDef)) as Record<string, unknown> & {
      visits: number;
      greet: (n: string) => PromiseLike<string>;
    };

    expect(res.visits).toBe(0);
    expect(await res.greet("Sam")).toBe("Hi Sam");
    expect(res.visits).toBe(1);
    expect(greeter.visits).toBe(1);
    expect(server.connections.size).toBe(1);

    client.close();
    await server.close();
  });
});

describe("EpServer WebSocket subprotocol enforcement", () => {
  it("accepts an upgrade that requests the EP subprotocol and negotiates it back", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    await wh.open();
    const server = await EpServer.listen({ port: 0, warehouse: wh });

    const ws = new WsWebSocket(`ws://127.0.0.1:${server.port}`, "EP");
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    expect(ws.protocol).toBe("EP");
    expect(server.connections.size).toBe(1);

    ws.close();
    await server.close();
  });

  it("rejects an upgrade that doesn't request the EP subprotocol with HTTP 400", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    await wh.open();
    const server = await EpServer.listen({ port: 0, warehouse: wh });

    // No subprotocol offered at all.
    const bare = new WsWebSocket(`ws://127.0.0.1:${server.port}`);
    const bareStatus = await new Promise<number | undefined>((resolve) => {
      bare.once("unexpected-response", (_req, res) => resolve(res.statusCode));
      bare.once("open", () => resolve(undefined));
    });
    expect(bareStatus).toBe(400);

    // A different subprotocol offered, but not "EP".
    const wrong = new WsWebSocket(`ws://127.0.0.1:${server.port}`, "chat");
    const wrongStatus = await new Promise<number | undefined>((resolve) => {
      wrong.once("unexpected-response", (_req, res) => resolve(res.statusCode));
      wrong.once("open", () => resolve(undefined));
    });
    expect(wrongStatus).toBe(400);

    expect(server.connections.size).toBe(0);

    await server.close();
  });
});
