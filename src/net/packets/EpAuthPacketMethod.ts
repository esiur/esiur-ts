/**
 * Auth packet methods (port of C# `EpAuthPacketMethod`). The top 2 bits encode
 * the {@link EpAuthPacketCommand}; e.g. `SessionEstablished` (0x47) is an
 * Acknowledge.
 */
export enum EpAuthPacketMethod {
  // Initialize
  Initialize = 0x00,

  // Actions
  Handshake = 0x80,
  FinalHandshake = 0x81,

  // Acknowledgements
  Denied = 0x40,
  NotSupported = 0x41,
  TrySupported = 0x42,
  Retry = 0x43,
  ProceedToHandshake = 0x44,
  ProceedToFinalHandshake = 0x45,
  ProceedToEstablishSession = 0x46,
  SessionEstablished = 0x47,

  // Events
  Established = 0xc0,
  ErrorTerminate = 0xc1,
  ErrorMustEncrypt = 0xc2,
  ErrorRetry = 0xc3,
  IndicationEstablished = 0xc8,
  IAuthPlain = 0xd0,
  IAuthHashed = 0xd1,
  IAuthEncrypted = 0xd2,
}
