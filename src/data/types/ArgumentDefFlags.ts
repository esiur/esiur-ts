/**
 * Argument flags (port of C# `ArgumentDefFlags`). Standalone — NOT built on
 * {@link MemberDefFlags}, since arguments have no `Inherited`/`Deprecated`
 * concept.
 */
export enum ArgumentDefFlags {
  None = 0x00,
  Optional = 0x01,
  Variadic = 0x02,
}
