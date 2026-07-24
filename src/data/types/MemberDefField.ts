/**
 * Wire indices shared by every member kind (property/function/event/constant/
 * argument), port of C# `MemberDefField`. Subclass-specific fields start at
 * `0x03`, reusing these base slots for everything else.
 */
export enum MemberDefField {
  Index = 0x00,
  Name = 0x01,
  Flags = 0x02,
  Description = 0x20,
  Usage = 0x21,
  Examples = 0x22,
  Tags = 0x23,
  Unit = 0x24,
  Minimum = 0x25,
  Maximum = 0x26,
  AllowedValues = 0x27,
  Pattern = 0x28,
  Format = 0x29,
  Preconditions = 0x2a,
  Postconditions = 0x2b,
  Effects = 0x2c,
  Warnings = 0x2d,
  RelatedMembers = 0x2e,
  DeprecationMessage = 0x2f,
  Annotations = 0x30,
}
