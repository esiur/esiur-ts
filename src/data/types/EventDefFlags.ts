/** Event flags, extending {@link MemberDefFlags} (port of C# `EventDefFlags`). */
export enum EventDefFlags {
  None = 0x00,
  Inherited = 0x01,
  Deprecated = 0x02,
  AutoDelivered = 0x04,
  Historical = 0x08,
}
