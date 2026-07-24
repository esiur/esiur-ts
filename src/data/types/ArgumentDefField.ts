/**
 * Argument-specific wire indices, starting at 0x03 (port of C#
 * `ArgumentDefField`). An argument's name comes from the inherited
 * `MemberDefField.Name` slot; there is no separate name field here.
 */
export enum ArgumentDefField {
  ValueType = 0x03,
  DefaultValue = 0x04,
}
