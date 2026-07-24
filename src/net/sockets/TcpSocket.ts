import { AsyncReply } from "../../core/AsyncReply.js";
import { AsyncException } from "../../core/AsyncException.js";
import type { DestroyedEvent } from "../../core/IDestructible.js";
import { NetworkBuffer } from "../NetworkBuffer.js";
import type { INetworkReceiver } from "../INetworkReceiver.js";
import type { ISocket } from "./ISocket.js";
import { SocketState } from "./SocketState.js";

type NodeSocket = import("node:net").Socket;
type NetModule = typeof import("node:net");

/**
 * Raw TCP transport (port of C# `TcpSocket`), for Node.js hosts talking to an
 * esiur-dotnet server that only listens on its native TCP `TcpServer` (no
 * WebSocket upgrade route registered) — esiur-ts could otherwise only ever
 * connect via {@link WSocket}.
 *
 * Node-only: `node:net` is loaded via a dynamic `import()` inside
 * {@link connect} rather than a static top-level import, matching
 * `WSocket.ts`'s environment-detection convention exactly — this file's mere
 * existence (and the type-only `import("node:net")` above, erased at compile
 * time) is safe to ship in a browser bundle; it only throws if actually
 * connected to from a non-Node runtime.
 */
export class TcpSocket implements ISocket {
  state: SocketState = SocketState.Initial;
  receiver?: INetworkReceiver<ISocket>;

  private sock?: NodeSocket;
  private readonly buffer = new NetworkBuffer();
  private readonly destroyHandlers: DestroyedEvent[] = [];

  /** `url` is `tcp://host:port`. */
  connect(url: string): AsyncReply<boolean> {
    const reply = new AsyncReply<boolean>();
    this.state = SocketState.Connecting;

    (async () => {
      try {
        const { hostname, port } = parseTcpUrl(url);
        const net = await getNetModule();

        if (this.state !== SocketState.Connecting) return;

        const sock = net.connect({ host: hostname, port });
        this.attach(sock);

        sock.once("connect", () => {
          this.state = SocketState.Established;
          reply.trigger(true);
          this.receiver?.networkConnect(this);
        });
        sock.once("error", (err: Error) => {
          if (this.state === SocketState.Connecting) reply.triggerError(AsyncException.from(err));
        });
      } catch (error) {
        this.state = SocketState.Closed;
        reply.triggerError(AsyncException.from(error));
      }
    })();

    return reply;
  }

  private attach(sock: NodeSocket): void {
    this.sock = sock;

    sock.on("data", (chunk: Buffer) => {
      this.buffer.write(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      this.receiver?.networkReceive(this, this.buffer);
    });
    sock.on("close", () => {
      this.state = SocketState.Closed;
      this.receiver?.networkClose(this);
    });
    // A post-handshake error (post-`connect`) should still tear the socket
    // down cleanly rather than crash the process on an unhandled 'error'.
    sock.on("error", () => {
      if (this.state !== SocketState.Connecting) this.close();
    });
  }

  send(message: Uint8Array): void {
    this.sock?.write(message);
  }

  close(): void {
    this.state = SocketState.Closed;
    this.sock?.end();
  }

  addDestroyHandler(handler: DestroyedEvent): void {
    this.destroyHandlers.push(handler);
  }

  removeDestroyHandler(handler: DestroyedEvent): void {
    const i = this.destroyHandlers.indexOf(handler);
    if (i >= 0) this.destroyHandlers.splice(i, 1);
  }

  destroy(): void {
    this.close();
    this.receiver = undefined;
    this.sock = undefined;
    for (const h of this.destroyHandlers.slice()) h(this);
  }
}

function parseTcpUrl(url: string): { hostname: string; port: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid TCP URL: ${url}`);
  }
  const port = Number(parsed.port);
  if (!parsed.hostname || !Number.isFinite(port) || port <= 0)
    throw new Error(`Invalid TCP URL: ${url}`);
  return { hostname: parsed.hostname, port };
}

async function getNetModule(): Promise<NetModule> {
  try {
    return await import("node:net");
  } catch (error) {
    throw new Error(
      "TcpSocket requires Node.js — the 'node:net' module is unavailable in this environment.",
      { cause: error },
    );
  }
}
