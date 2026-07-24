import type { IResourceManager } from "./IResourceManager.js";
import type { ResourceManagerContext } from "./ResourceManagerContext.js";
import type { Ruling } from "../permissions/Ruling.js";

/**
 * Audits a resource operation before it is executed (port of C#
 * `IAuditingManager`). A `Denied` result may veto the operation, while
 * `Allowed` and `DontCare` never grant authorization or override another
 * manager's denial.
 */
export interface IAuditingManager extends IResourceManager {
  readonly managerCategory: "auditing";
  applicable(context: ResourceManagerContext): Ruling;
}
