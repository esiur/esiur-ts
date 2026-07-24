import type { IResource } from "../../resource/IResource.js";
import type { MemberTemplate } from "../../resource/template.js";
import type { AuthenticationSession } from "../AuthenticationSession.js";
import { ActionType } from "./ActionType.js";
import type { IPermissionsManager } from "./IPermissionsManager.js";
import { Ruling } from "./Ruling.js";

const RESOURCE_PERMISSION_KEYS: ReadonlyMap<ActionType, string> = new Map([
  [ActionType.Attach, "_attach"],
  [ActionType.Detach, "_detach"],
  [ActionType.Delete, "_delete"],
  [ActionType.CreateResource, "_create_resource"],
  [ActionType.InquireAttributes, "_get_attributes"],
  [ActionType.UpdateAttributes, "_set_attributes"],
  [ActionType.AddChild, "_add_child"],
  [ActionType.RemoveChild, "_remove_child"],
  [ActionType.AddParent, "_add_parent"],
  [ActionType.RemoveParent, "_remove_parent"],
  [ActionType.Rename, "_rename"],
  [ActionType.ViewTypeDef, "_view_typedef"],
]);

/**
 * Per-identity permissions from a settings map (port of C#
 * `UserPermissionsManager`). Settings shape: `{ [identity|"public"]: {
 * [resourcePermissionKey|memberName]: "yes" | ... } }`.
 */
export class UserPermissionsManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  private _settings: Map<string, unknown> | undefined;

  constructor(settings?: Map<string, unknown>) {
    this._settings = settings;
  }

  get settings(): Map<string, unknown> | undefined {
    return this._settings;
  }

  applicable(
    resource: IResource | null,
    session: AuthenticationSession | null,
    action: ActionType,
    member: MemberTemplate | null,
    _inquirer?: unknown,
  ): Ruling {
    if (!this._settings || !session) return Ruling.Denied;

    let userPermissions: Map<string, unknown> | undefined;
    if (session.remoteIdentity && this._settings.get(session.remoteIdentity) instanceof Map) {
      userPermissions = this._settings.get(session.remoteIdentity) as Map<string, unknown>;
    } else if (this._settings.get("public") instanceof Map) {
      userPermissions = this._settings.get("public") as Map<string, unknown>;
    }

    if (!userPermissions) return Ruling.Denied;

    const resourcePermissionKey = RESOURCE_PERMISSION_KEYS.get(action);
    if (resourcePermissionKey) return isAllowed(userPermissions, resourcePermissionKey);

    // Member-level access is fail closed: an absent member/action entry must
    // never fall through to Warehouse's compatibility defaults.
    const rawMemberPermissions = member ? userPermissions.get(member.name) : undefined;
    if (!(rawMemberPermissions instanceof Map)) return Ruling.Denied;

    return isAllowed(rawMemberPermissions, ActionType[action]);
  }

  initialize(settings: Map<string, unknown> | undefined, _resource: IResource | null): boolean {
    this._settings = settings;
    return true;
  }
}

function isAllowed(permissions: Map<string, unknown>, key: string): Ruling {
  return permissions.get(key) === "yes" ? Ruling.Allowed : Ruling.Denied;
}
