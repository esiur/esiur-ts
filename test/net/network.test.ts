import { describe, it, expect } from "vitest";
import { WebSocketServer } from "ws";
import { NetworkBuffer } from "../../src/net/NetworkBuffer.js";
import { WSocket } from "../../src/net/sockets/WSocket.js";
import { SocketState } from "../../src/net/sockets/SocketState.js";
import type { ISocket } from "../../src/net/sockets/ISocket.js";

describe("NetworkBuffer", () => {
  it("reads all written bytes when not holding", () => {
    const b = new NetworkBuffer();
    b.write(Uint8Array.of(1, 2, 3));
    expect(b.canRead).toBe(true);
    expect([...b.read()!]).toEqual([1, 2, 3]);
    expect(b.read()).toBe(null);
  });

  it("holds back a partial unit until enough bytes arrive", () => {
    const b = new NetworkBuffer();
    b.write(Uint8Array.of(0xaa, 0xbb));
    const msg = b.read()!;

    // Parser needs 4 bytes from offset 0 but only 2 are present.
    expect(b.protect(msg, 0, 4)).toBe(true);
    expect(b.protected_).toBe(true);
    expect(b.canRead).toBe(false);

    b.write(Uint8Array.of(0xcc, 0xdd));
    expect(b.protected_).toBe(false);
    expect(b.canRead).toBe(true);
    expect([...b.read()!]).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });

  it("holdFor prepends the tail before subsequent writes", () => {
    const b = new NetworkBuffer();
    b.holdFor(Uint8Array.of(9, 9), 0, 2, 5);
    expect(b.canRead).toBe(false);
    b.write(Uint8Array.of(1, 2, 3));
    expect([...b.read()!]).toEqual([9, 9, 1, 2, 3]);
  });
});

describe("WSocket loopback (via ws echo server)", () => {
  it("connects, sends and receives binary frames", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.on("listening", () => r()));
    const port = (wss.address() as { port: number }).port;
    wss.on("connection", (ws) => ws.on("message", (data: Buffer) => ws.send(data)));

    const sock = new WSocket();
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

    await sock.connect(`ws://127.0.0.1:${port}`);
    expect(sock.state).toBe(SocketState.Established);

    sock.send(Uint8Array.of(1, 2, 3, 4));
    expect(await gotMsg).toEqual([1, 2, 3, 4]);

    sock.close();
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it("falls back to the ws peer when global WebSocket is unavailable", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const wss = new WebSocketServer({ port: 0 });
    try {
      await new Promise<void>((r) => wss.on("listening", () => r()));
      const port = (wss.address() as { port: number }).port;
      wss.on("connection", (ws) => ws.on("message", (data: Buffer) => ws.send(data)));

      const sock = new WSocket();
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

      await sock.connect(`ws://127.0.0.1:${port}`);
      expect(sock.state).toBe(SocketState.Established);

      sock.send(Uint8Array.of(5, 6, 7, 8));
      expect(await gotMsg).toEqual([5, 6, 7, 8]);
      sock.close();
    } finally {
      await new Promise<void>((r) => wss.close(() => r()));
      if (descriptor) Object.defineProperty(globalThis, "WebSocket", descriptor);
      else Reflect.deleteProperty(globalThis, "WebSocket");
    }
  });
});
