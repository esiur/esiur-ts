/**
 * Which category a resource manager belongs to. dotnet discriminates
 * `IPermissionsManager`/`IRateControlManager`/`IAuditingManager` at runtime
 * via `is` pattern-matching over their (otherwise-empty) marker interface;
 * TS has no equivalent runtime interface check, so every concrete manager
 * carries this brand instead.
 */
export type ManagerCategory = "permissions" | "rateControl" | "auditing";

/**
 * Identifies a manager that participates in resource operation processing
 * (port of C# `IResourceManager`). Category interfaces add the behavior
 * appropriate to each manager type.
 */
export interface IResourceManager {
  readonly managerCategory: ManagerCategory;
}
