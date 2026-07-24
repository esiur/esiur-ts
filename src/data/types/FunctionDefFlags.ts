/** Function flags, extending {@link MemberDefFlags} (port of C# `FunctionDefFlags`). */
export enum FunctionDefFlags {
  None = 0x00,
  Inherited = 0x01,
  Deprecated = 0x02,
  Static = 0x04,
  ReadOnly = 0x08,
  Idempotent = 0x10,
  Cancellable = 0x20,
  Pausable = 0x40,
}
