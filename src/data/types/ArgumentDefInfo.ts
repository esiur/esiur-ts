import { Index } from "../IndexAttribute.js";
import type { Tru } from "../Tru.js";
import { MemberDefInfo } from "./MemberDefInfo.js";

/**
 * Wire-format shape of a function argument (port of C# `ArgumentDefInfo`).
 * The argument's name comes from the inherited `MemberDefInfo.name` field.
 */
export class ArgumentDefInfo extends MemberDefInfo {
  @Index(0x03) valueType: Tru | undefined;
  @Index(0x04) defaultValue: unknown;
}
