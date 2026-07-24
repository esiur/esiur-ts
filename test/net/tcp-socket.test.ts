import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:net";
import { TcpSocket } from "../../src/net/sockets/TcpSocket.js";
import { SocketState } from "../../src/net/sockets/SocketState.js";
import type { ISocket } from "../../src/net/sockets/ISocket.js";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

describe("TcpSocket loopback (via node:net echo server)", () => {
  it("connects, sends and receives bytes", async () => {
    const server = createServer((conn) => conn.on("data", (data) => conn.write(data)));
    const port = await listen(server);

    const sock = new TcpSocket();
    let resolveMsg!: (v: number[]) => void;
    const gotMsg = new Promise<number[]>((r) => (resolveMsg = r));

    sock.receiver = {
      networkConnect() {},
      networkClose() {},
      networkReceive(_s: ISocket, buffer) {
        const m = buffer.read();
        if (m) resolveMsg([...m]);
      },
    };

    await sock.connect(`tcp://127.0.0.1:${port}`);
    expect(sock.state).toBe(SocketState.Established);

    sock.send(Uint8Array.of(1, 2, 3, 4));
    expect(await gotMsg).toEqual([1, 2, 3, 4]);

    sock.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("rejects the connect reply when nothing is listening", async () => {
    const sock = new TcpSocket();
    await expect(sock.connect("tcp://127.0.0.1:1")).rejects.toBeTruthy();
  });

  it("rejects an invalid TCP URL", async () => {
    const sock = new TcpSocket();
    await expect(sock.connect("not a url")).rejects.toBeTruthy();
  });
});
