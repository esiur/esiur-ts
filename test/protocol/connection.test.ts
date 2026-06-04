import { describe, it, expect } from "vitest";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { WSocket } from "../../src/net/sockets/WSocket.js";
import { EpPacketRequest } from "../../src/net/packets/EpPacketRequest.js";
import { ErrorType } from "../../src/core/ErrorType.js";
import { parse } from "../../src/data/Codec.js";

/**
 * End-to-end protocol loopback over a real WebSocket pair: a client EpConnection
 * issues requests; a server EpConnection correlates them by callback id and
 * replies. Exercises the request/reply engine and reply decoding/error mapping
 * (the resource-invoke handlers and handshake are layered on later).
 */
describe("EpConnection request/reply loopback", () => {
  it("correlates a request with its reply and decodes the result", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.on("listening", () => r()));
    const port = (wss.address() as { port: number }).port;

    wss.on("connection", (raw: WsWebSocket) => {
      const serverConn = new EpConnection();
      serverConn.onRequest = (conn, action, callbackId, tdu) => {
        if (action !== EpPacketRequest.InvokeFunction || !tdu) return;
        const args = parse(tdu.data, tdu.tduOffset) as unknown[]; // [resourceId, index, message]
        if (args[0] === 1) {
          conn.sendReply(0 /* Completed */, callbackId, `hello ${String(args[2])}`);
        } else {
          conn.sendError(ErrorType.Exception, callbackId, 5, "no such resource");
        }
      };
      serverConn.assign(new WSocket(raw as unknown as WebSocket));
    });

    const client = new EpConnection();
    const sock = new WSocket();
    client.assign(sock);
    await sock.connect(`ws://127.0.0.1:${port}`);

    const result = await client.sendRequest(EpPacketRequest.InvokeFunction, 1, 0, "world");
    expect(result).toBe("hello world");

    await expect(
      client.sendRequest(EpPacketRequest.InvokeFunction, 99, 0, "x") as PromiseLike<unknown>,
    ).rejects.toMatchObject({ type: ErrorType.Exception, message: "no such resource" });

    client.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });
});
