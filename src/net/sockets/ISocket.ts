import type { IDestructible } from "../../core/IDestructible.js";
import type { AsyncReply } from "../../core/AsyncReply.js";
import type { INetworkReceiver } from "../INetworkReceiver.js";
import type { SocketState } from "./SocketState.js";

/**
 * Transport abstraction (port of C# `ISocket`, trimmed to the isomorphic
 * surface). Implementations wrap a WebSocket or TCP socket and push inbound
 * bytes to their {@link receiver}.
 */
export interface ISocket extends IDestructible {
  readonly state: SocketState;
  receiver?: INetworkReceiver<ISocket>;

  /** Send bytes to the peer. */
  send(message: Uint8Array): void;
  /** Close the connection. */
  close(): void;
  /** Connect to a remote endpoint (client sockets); resolves once established. */
  connect(url: string): AsyncReply<boolean>;
}
