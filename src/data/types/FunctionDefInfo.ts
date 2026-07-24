import { Index } from "../IndexAttribute.js";
import type { Tru } from "../Tru.js";
import { MemberDefInfo } from "./MemberDefInfo.js";
import { StreamMode } from "./StreamMode.js";
import type { ArgumentDefInfo } from "./ArgumentDefInfo.js";

/** Wire-format shape of a function definition (port of C# `FunctionDefInfo`). */
export class FunctionDefInfo extends MemberDefInfo {
  @Index(0x03) arguments: ArgumentDefInfo[] | undefined;
  @Index(0x04) returnType: Tru | undefined;
  @Index(0x05) streamMode: StreamMode = StreamMode.None;
}
