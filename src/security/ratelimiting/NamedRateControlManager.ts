import type { IRateControlManager } from "../management/IRateControlManager.js";
import type { ResourceManagerContext } from "../management/ResourceManagerContext.js";
import { ActionType } from "../permissions/ActionType.js";
import { Ruling } from "../permissions/Ruling.js";
import { RateControlContext } from "./RatePolicy.js";

/**
 * Bridges the named Warehouse rate-policy registry into the unified
 * resource-manager pipeline (port of C# `NamedRateControlManager`). Applies
 * only to members carrying a `@RateControl(name)` policy name, and only for
 * `Execute`/`SetProperty` actions.
 */
export class NamedRateControlManager implements IRateControlManager {
  readonly managerCategory = "rateControl" as const;

  applicable(context: ResourceManagerContext): Ruling {
    if (context.action !== ActionType.Execute && context.action !== ActionType.SetProperty)
      return Ruling.DontCare;

    const policyName = (context.member as { ratePolicyName?: string } | null)?.ratePolicyName;
    if (!policyName) return Ruling.DontCare;

    if (!context.connection || !context.session || !context.member) {
      context.denialReason = `Rate policy \`${policyName}\` requires an authenticated connection.`;
      return Ruling.Denied;
    }

    const policy = context.warehouse.tryGetRatePolicy(policyName);
    if (!policy) {
      context.denialReason = `Rate policy \`${policyName}\` is not registered.`;
      return Ruling.Denied;
    }

    const rateContext = new RateControlContext(
      context.warehouse,
      context.connection,
      context.session,
      context.resource,
      context.member,
      context.action,
    );

    const ruling = policy.applicable(rateContext);
    if (rateContext.delay > context.delay) context.delay = rateContext.delay;

    if (ruling === Ruling.Denied && !context.denialReason)
      context.denialReason = `Rate policy \`${policyName}\` denied \`${context.member.name}\`.`;

    return ruling;
  }
}
