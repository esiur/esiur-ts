import { Index } from "../IndexAttribute.js";
import type { Tru } from "../Tru.js";
import { MemberDefInfo } from "./MemberDefInfo.js";

/** Wire-format shape of a constant definition (port of C# `ConstantDefInfo`). */
export class ConstantDefInfo extends MemberDefInfo {
  @Index(0x03) valueType: Tru | undefined;
  @Index(0x04) value: unknown;
}
