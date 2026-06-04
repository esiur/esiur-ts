/** Reply actions, in the low 5 bits of the header (port of C# `EpPacketReply`). */
export enum EpPacketReply {
  // Success
  Completed = 0x0,
  Propagated = 0x1,
  Stream = 0x2,
  // Error
  PermissionError = 0x4,
  ExecutionError = 0x5,
  // Partial
  Progress = 0x8,
  Chunk = 0x9,
  Warning = 0xa,
}
