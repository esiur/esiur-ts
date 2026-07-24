import type { Warehouse } from "../../resource/Warehouse.js";
import type { EpConnection } from "../../protocol/EpConnection.js";
import type { AuthenticationSession } from "../AuthenticationSession.js";
import type { IResource } from "../../resource/IResource.js";
import type { MemberTemplate } from "../../resource/template.js";
import type { ActionType } from "../permissions/ActionType.js";
import { Ruling } from "../permissions/Ruling.js";

/** Describes the request currently being evaluated by a rate policy (port of C# `RateControlContext`). */
export class RateControlContext {
  /** Optional delay (ms) assigned by a policy to an allowed queued request. */
  delay = 0;

  constructor(
    readonly warehouse: Warehouse,
    readonly connection: EpConnection,
    readonly session: AuthenticationSession,
    readonly resource: IResource | null,
    readonly member: MemberTemplate,
    readonly action: ActionType,
  ) {}
}

/**
 * Base class for named Warehouse rate-control policies (port of C#
 * `RatePolicy`). dotnet exposes this as two overloads (a context-free
 * `Applicable()` and a context-aware `Applicable(RateControlContext)`,
 * the latter defaulting to calling the former) — TS collapses them into one
 * overridable method, since it has no overload-resolution equivalent;
 * context-free policies simply ignore the parameter.
 */
export abstract class RatePolicy {
  constructor(public name: string = "") {}

  /** Evaluate a request. Override for context-aware policies (e.g. {@link BurstRatePolicy}). */
  applicable(_context?: RateControlContext): Ruling {
    return Ruling.DontCare;
  }
}
