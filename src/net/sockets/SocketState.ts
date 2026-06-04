/** Lifecycle state of an {@link ISocket} (port of C# `SocketState`). */
export enum SocketState {
  Initial = 0,
  Listening = 1,
  Connecting = 2,
  Established = 3,
  Closed = 4,
}
