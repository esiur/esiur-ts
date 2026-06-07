import { EventHandler } from "../core/EventHandler.js";
import type { DestroyedEvent, IDestructible } from "../core/IDestructible.js";
import type { NetworkBuffer } from "./NetworkBuffer.js";
import type { INetworkReceiver } from "./INetworkReceiver.js";
import type { ISocket } from "./sockets/ISocket.js";
import { SocketState } from "./sockets/SocketState.js";

/**
 * Base for a logical connection over an {@link ISocket} (port of C#
 * `NetworkConnection`). Owns the socket, drains inbound buffers to
 * {@link dataReceived}, and exposes send helpers. Subclasses implement the
 * protocol-specific framing.
 */
export abstract class NetworkConnection
  implements INetworkReceiver<ISocket>, IDestructible
{
  protected socket?: ISocket;
  private receivingFlag = false;

  readonly onConnect = new EventHandler<NetworkConnection>();
  readonly onClose = new EventHandler<NetworkConnection>();
  private readonly destroyHandlers: DestroyedEvent[] = [];

  /** Attach a socket and route its events here. */
  assign(socket: ISocket): void {
    this.socket = socket;
    socket.receiver = this;
  }

  /** Detach the socket without closing it (e.g. for a protocol upgrade). */
  unassign(): ISocket | undefined {
    const sock = this.socket;
    if (!sock) return undefined;
    sock.receiver = undefined;
    this.socket = undefined;
    return sock;
  }

  get isConnected(): boolean {
    return this.socket != null && this.socket.state === SocketState.Established;
  }

  send(message: Uint8Array): void {
    this.socket?.send(message);
  }

  close(): void {
    this.socket?.close();
  }

  networkConnect(_socket: ISocket): void {
    if (_socket !== this.socket) return;
    this.connected();
    this.onConnect.emit(this);
  }

  networkClose(_socket: ISocket): void {
    if (_socket !== this.socket) return;
    this.disconnected();
    this.onClose.emit(this);
  }

  networkReceive(_sender: ISocket, buffer: NetworkBuffer): void {
    if (_sender !== this.socket || this.socket.state === SocketState.Closed) return;

    // Drain once; re-entrant callbacks return and let the active drain continue.
    if (this.receivingFlag) return;
    this.receivingFlag = true;
    try {
      while (buffer.available > 0 && !buffer.protected_) this.dataReceived(buffer);
    } finally {
      this.receivingFlag = false;
    }
  }

  protected abstract dataReceived(buffer: NetworkBuffer): void;
  protected abstract connected(): void;
  protected abstract disconnected(): void;

  addDestroyHandler(handler: DestroyedEvent): void {
    this.destroyHandlers.push(handler);
  }

  removeDestroyHandler(handler: DestroyedEvent): void {
    const i = this.destroyHandlers.indexOf(handler);
    if (i >= 0) this.destroyHandlers.splice(i, 1);
  }

  destroy(): void {
    this.socket?.destroy();
    this.socket = undefined;
    for (const h of this.destroyHandlers.slice()) h(this);
  }
}
