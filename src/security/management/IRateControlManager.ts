import type { IResourceManager } from "./IResourceManager.js";
import type { ResourceManagerContext } from "./ResourceManagerContext.js";
import type { Ruling } from "../permissions/Ruling.js";

/**
 * Evaluates whether a resource operation is admitted by rate-control policy
 * (port of C# `IRateControlManager`). A manager may assign
 * `context.delay` when allowing an operation that should be queued and
 * `context.supportsDelay` is true.
 */
export interface IRateControlManager extends IResourceManager {
  readonly managerCategory: "rateControl";
  applicable(context: ResourceManagerContext): Ruling;
}
