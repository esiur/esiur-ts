/** Side effects a member's invocation may have (port of C# `OperationEffects`). Flags. */
export enum OperationEffects {
  None = 0x00,
  ModifiesState = 0x01,
  CreatesResource = 0x02,
  DeletesResource = 0x04,
  External = 0x08,
  EmitsEvents = 0x10,
  Unknown = 0x80,
}
