import { describe, it, expect } from "vitest";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { WSocket } from "../../src/net/sockets/WSocket.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";

class HelloResource extends Resource {
  @Export(t.i32) accessor counts = 0;

  @Export(t.string, [t.string])
  sayHi(msg: string): string {
    this.counts++;
    return `Welcome, ${msg}`;
  }

  @Export(t.i32, [t.i32, t.i32])
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }
}

describe("EpConnection remote invoke (TS ↔ TS)", () => {
  it("invokes remote functions (sync + async) and sets a remote property", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    const hello = await wh.put("sys/hello", new HelloResource());
    await wh.open();

    const helloId = hello.instance!.id;
    const typeDef = wh.getTypeDef(HelloResource);
    const sayHiIndex = typeDef.getFunctionByName("sayHi")!.index;
    const addIndex = typeDef.getFunctionByName("add")!.index;
    const countsIndex = typeDef.getPropertyByName("counts")!.index;

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

    // sync function + observed server-side side effect
    expect(await client.invoke(helloId, sayHiIndex, "Ahmed")).toBe("Welcome, Ahmed");
    expect(hello.counts).toBe(1);

    // async function (returns a Promise on the server)
    expect(await client.invoke(helloId, addIndex, 2, 40)).toBe(42);

    // set a remote property
    await client.set(helloId, countsIndex, 100);
    expect(hello.counts).toBe(100);

    // unknown resource id → ResourceNotFound (code 5)
    await expect(
      client.invoke(9999, sayHiIndex, "x") as PromiseLike<unknown>,
    ).rejects.toMatchObject({ code: 5 });

    client.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });
});
