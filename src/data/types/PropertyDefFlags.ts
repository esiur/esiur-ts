/** Property flags, extending {@link MemberDefFlags} (port of C# `PropertyDefFlags`). */
export enum PropertyDefFlags {
  None = 0x00,
  Inherited = 0x01,
  Deprecated = 0x02,
  ReadOnly = 0x04,
  Constant = 0x08,
  Volatile = 0x10,
  Historical = 0x20,
}
