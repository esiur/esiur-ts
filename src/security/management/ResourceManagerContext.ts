import type { Warehouse } from "../../resource/Warehouse.js";
import type { EpConnection } from "../../protocol/EpConnection.js";
import type { AuthenticationSession } from "../AuthenticationSession.js";
import type { IResource } from "../../resource/IResource.js";
import type { MemberTemplate, TypeDef } from "../../resource/template.js";
import type { ActionType } from "../permissions/ActionType.js";

/**
 * Metadata describing a resource operation being evaluated by managers
 * (port of C# `ResourceManagerContext`). Operation identity is immutable;
 * {@link ResourceManagerContext.delay}/{@link ResourceManagerContext.denialReason}
 * let a manager return admission details.
 *
 * `memberPolicyAttributes` is always empty in this port: dotnet lets any
 * custom `Attribute` ride along for bespoke manager types via reflection;
 * TS has no reflection-based generic attribute bag to source that from, and
 * nothing in this port's manager set (Permissions/RateControl/Auditing)
 * reads it, so it's kept only for shape parity with the C# constructor.
 */
export class ResourceManagerContext {
  /** Optional delay requested by a rate-control manager. */
  delay = 0;
  /** Optional public-safe reason supplied by a manager when it denies an operation. */
  denialReason: string | undefined;

  readonly memberPolicyAttributes: readonly unknown[];
  readonly typeDefinition: TypeDef | null;

  constructor(
    readonly warehouse: Warehouse,
    readonly connection: EpConnection | null,
    readonly session: AuthenticationSession | null,
    readonly resource: IResource | null,
    readonly member: MemberTemplate | null,
    readonly action: ActionType,
    readonly inquirer: unknown = null,
    memberPolicyAttributes: readonly unknown[] = [],
    typeDefinition: TypeDef | null = null,
    readonly supportsDelay = false,
  ) {
    this.memberPolicyAttributes = memberPolicyAttributes;
    this.typeDefinition = typeDefinition;
  }
}
