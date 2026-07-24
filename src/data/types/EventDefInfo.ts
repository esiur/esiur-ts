import { Index } from "../IndexAttribute.js";
import type { Tru } from "../Tru.js";
import { MemberDefInfo } from "./MemberDefInfo.js";
import { OrderingControl } from "../OrderingControl.js";

/** Wire-format shape of an event definition (port of C# `EventDefInfo`). */
export class EventDefInfo extends MemberDefInfo {
  @Index(0x03) argumentType: Tru | undefined;
  @Index(0x04) argumentName: string | undefined;
  @Index(0x05) orderingControl: OrderingControl = OrderingControl.Strict;
  @Index(0x06) historyControl = 0;
}
