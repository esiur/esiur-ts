import { Index } from "../IndexAttribute.js";
import type { Tru } from "../Tru.js";
import { MemberDefInfo } from "./MemberDefInfo.js";
import { OrderingControl } from "../OrderingControl.js";

/** Wire-format shape of a property definition (port of C# `PropertyDefInfo`). */
export class PropertyDefInfo extends MemberDefInfo {
  @Index(0x03) valueType: Tru | undefined;
  @Index(0x04) orderingControl: OrderingControl = OrderingControl.Strict;
  @Index(0x05) historyControl = 0;
  @Index(0x06) defaultValue: unknown;
}
