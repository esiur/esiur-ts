import type { IResourceManager } from "../management/IResourceManager.js";
import type { IResource } from "../../resource/IResource.js";
import type { MemberTemplate } from "../../resource/template.js";
import type { AuthenticationSession } from "../AuthenticationSession.js";
import type { ActionType } from "./ActionType.js";
import type { Ruling } from "./Ruling.js";

/**
 * Checks permission for a resource operation (port of C#
 * `IPermissionsManager`). Predates {@link IRateControlManager}/
 * {@link IAuditingManager}'s newer `ResourceManagerContext`-based signature
 * and was never refactored to match — ported faithfully rather than
 * "cleaned up" to be consistent, since `tryApplyManagers` genuinely calls
 * permissions managers differently from rate/auditing managers.
 */
export interface IPermissionsManager extends IResourceManager {
  readonly managerCategory: "permissions";

  applicable(
    resource: IResource | null,
    session: AuthenticationSession | null,
    action: ActionType,
    member: MemberTemplate | null,
    inquirer?: unknown,
  ): Ruling;

  initialize(settings: Map<string, unknown> | undefined, resource: IResource | null): boolean;

  readonly settings: Map<string, unknown> | undefined;
}
