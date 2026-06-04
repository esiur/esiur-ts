import type { NetworkBuffer } from "./NetworkBuffer.js";

/** Receives transport events from an {@link ISocket} (port of C# `INetworkReceiver`). */
export interface INetworkReceiver<T> {
  networkClose(sender: T): void;
  networkReceive(sender: T, buffer: NetworkBuffer): void;
  networkConnect(sender: T): void;
}
