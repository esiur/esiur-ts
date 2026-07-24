import { IndexedStructure } from "../IndexedStructure.js";
import { Index } from "../IndexAttribute.js";

/**
 * Base wire-format shape shared by every member kind (property/function/
 * event/constant/argument), port of C# `MemberDefInfo`. Carries the shared
 * identity fields plus the new documentation/semantics metadata surface
 * (`usage`/`description`/`examples`/`tags`/etc.) introduced alongside
 * `IndexedStructure`.
 */
export class MemberDefInfo extends IndexedStructure {
  @Index(0x00) index = 0;
  @Index(0x01) name = "";
  /** Raw flags byte; interpret via the subclass's own `*DefFlags` enum. */
  @Index(0x02) flags = 0;

  @Index(0x20) description: string | undefined;
  @Index(0x21) usage: string | undefined;
  @Index(0x22) examples: unknown[] | undefined;
  @Index(0x23) tags: string[] | undefined;
  @Index(0x24) unit: string | undefined;
  @Index(0x25) minimum: unknown;
  @Index(0x26) maximum: unknown;
  @Index(0x27) allowedValues: unknown[] | undefined;
  @Index(0x28) pattern: string | undefined;
  @Index(0x29) format: string | undefined;
  @Index(0x2a) preconditions: string[] | undefined;
  @Index(0x2b) postconditions: string[] | undefined;
  /** {@link import("./OperationEffects.js").OperationEffects} bitmask. */
  @Index(0x2c) effects = 0;
  @Index(0x2d) warnings: string[] | undefined;
  @Index(0x2e) relatedMembers: number[] | undefined;
  @Index(0x2f) deprecationMessage: string | undefined;
  @Index(0x30) annotations: Map<string, string> | undefined;
}
