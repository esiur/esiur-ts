import { AsyncReply } from "../../core/AsyncReply.js";
import { AsyncException } from "../../core/AsyncException.js";
import type { DestroyedEvent } from "../../core/IDestructible.js";
import { NetworkBuffer } from "../NetworkBuffer.js";
import type { INetworkReceiver } from "../INetworkReceiver.js";
import type { ISocket } from "./ISocket.js";
import { SocketState } from "./SocketState.js";

const textEncoder = new TextEncoder();

/**
 * The WebSocket subprotocol esiur-dotnet's `FrameworkWebSocket` requires be
 * negotiated (`FrameworkWebSocket.SubProtocol`, `Net/Sockets/FrameworkWebSocket.cs`).
 * A current esiur-dotnet server rejects the upgrade with `400 Bad Request`
 * if the client doesn't request it.
 */
const EP_SUBPROTOCOL = "EP";

/**
 * WebSocket transport (port of C# `WSocket`). Unlike the C# version it does no
 * frame parsing — both the browser `WebSocket` and Node's global `WebSocket`
 * (and `ws`) deliver already-deframed binary messages. Works in any environment
 * that exposes the standard `WebSocket` (browser, Node ≥ 21, or a `ws` instance
 * passed to the constructor).
 */
export class WSocket implements ISocket {
  state: SocketState = SocketState.Initial;
  receiver?: INetworkReceiver<ISocket>;

  private ws?: WebSocket;
  private readonly buffer = new NetworkBuffer();
  private readonly destroyHandlers: DestroyedEvent[] = [];
  private closeNotified = false;

  constructor(ws?: WebSocket) {
    if (ws) this.attach(ws);
  }

  connect(url: string): AsyncReply<boolean> {
    const reply = new AsyncReply<boolean>();
    this.state = SocketState.Connecting;
    this.closeNotified = false;

    (async () => {
      try {
        const ws = await createWebSocket(url);
        if (this.state !== SocketState.Connecting) {
          ws.close();
          return;
        }

        this.attach(ws);
        ws.addEventListener("open", () => {
          if (ws.protocol && ws.protocol !== EP_SUBPROTOCOL) {
            this.state = SocketState.Closed;
            ws.close();
            reply.triggerError(
              new AsyncException(
                new Error(
                  `The server did not negotiate the required '${EP_SUBPROTOCOL}' WebSocket subprotocol (got '${ws.protocol}').`,
                ),
              ),
            );
            return;
          }
          this.state = SocketState.Established;
          reply.trigger(true);
          this.receiver?.networkConnect(this);
        });
        ws.addEventListener("error", () => {
          if (this.state === SocketState.Connecting)
            reply.triggerError(
              new AsyncException(new Error(`WebSocket connection to ${url} failed.`)),
            );
        });
      } catch (error) {
        this.state = SocketState.Closed;
        reply.triggerError(AsyncException.from(error));
      }
    })();

    return reply;
  }

  private attach(ws: WebSocket): void {
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.addEventListener("message", (ev: MessageEvent) => {
      const bytes = toBytes(ev.data);
      if (bytes.length === 0) return;
      this.buffer.write(bytes);
      this.receiver?.networkReceive(this, this.buffer);
    });
    // Node's `ws` emits an EventEmitter `error` (for example when maxPayload
    // rejects a frame). Registering a listener prevents an otherwise
    // process-level uncaught exception; the transport's following close event
    // remains the single source of disconnect notification.
    ws.addEventListener("error", () => {});
    ws.addEventListener("close", () => this.transitionClosed());

    if (ws.readyState === 1) this.state = SocketState.Established;
  }

  send(message: Uint8Array): void {
    const ws = this.ws;
    if (
      !ws ||
      this.state !== SocketState.Established ||
      ws.readyState !== 1
    ) {
      // Browsers can leave a suspended tab with our logical state marked as
      // Established even though the native WebSocket has already entered
      // CLOSING/CLOSED. Notify the protocol immediately so it can fail pending
      // requests and schedule recovery, instead of calling WebSocket.send()
      // repeatedly and leaving replies that can never settle.
      this.transitionClosed();
      return;
    }

    ws.send(message);
  }

  close(): void {
    this.state = SocketState.Closed;
    this.ws?.close();
  }

  private transitionClosed(): void {
    this.state = SocketState.Closed;
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.receiver?.networkClose(this);
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
    this.ws = undefined;
    for (const h of this.destroyHandlers.slice()) h(this);
  }
}

/** Normalize a WebSocket message payload to bytes. */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") return textEncoder.encode(data);
  return new Uint8Array(0);
}

type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocket;

async function createWebSocket(url: string): Promise<WebSocket> {
  const ctor = await getWebSocketConstructor();
  return new ctor(url, EP_SUBPROTOCOL);
}

async function getWebSocketConstructor(): Promise<WebSocketConstructor> {
  if (typeof globalThis.WebSocket === "function")
    return globalThis.WebSocket as WebSocketConstructor;

  try {
    const ws = await import("ws");
    const ctor = ws.WebSocket ?? ws.default;
    if (typeof ctor === "function") return ctor as unknown as WebSocketConstructor;
  } catch (error) {
    throw new Error(
      "No WebSocket implementation is available. In Node.js 18-20, install the optional peer dependency 'ws'.",
      { cause: error },
    );
  }

  throw new Error(
    "No WebSocket implementation is available. In Node.js 18-20, install the optional peer dependency 'ws'.",
  );
}
