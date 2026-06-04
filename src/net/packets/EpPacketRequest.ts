/** Request actions, in the low 5 bits of the header (port of C# `EpPacketRequest`). */
export enum EpPacketRequest {
  // Invoke
  InvokeFunction = 0x0,
  SetProperty = 0x1,
  Subscribe = 0x2,
  Unsubscribe = 0x3,
  // Inquire
  TypeDefByName = 0x8,
  TypeDefById = 0x9,
  TypeDefByResourceId = 0xa,
  Query = 0xb,
  LinkTypeDefs = 0xc,
  Token = 0xd,
  GetResourceIdByLink = 0xe,
  // Manage
  AttachResource = 0x10,
  ReattachResource = 0x11,
  DetachResource = 0x12,
  CreateResource = 0x13,
  DeleteResource = 0x14,
  MoveResource = 0x15,
  // Static
  KeepAlive = 0x18,
  ProcedureCall = 0x19,
  StaticCall = 0x1a,
  IndirectCall = 0x1b,
  PullStream = 0x1c,
  TerminateExecution = 0x1d,
  HaltExecution = 0x1e,
}
