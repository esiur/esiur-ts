/** Which parties prove identity during the handshake (port of C# `AuthenticationMode`). */
export enum AuthenticationMode {
  None = 0x0,
  InitializerIdentity = 0x1,
  ResponderIdentity = 0x2,
  DualIdentity = 0x3,
}
