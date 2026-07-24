import type { IResource } from "../../resource/IResource.js";
import type { MemberTemplate } from "../../resource/template.js";
import type { AuthenticationSession } from "../AuthenticationSession.js";
import type { ActionType } from "./ActionType.js";
import type { IPermissionsManager } from "./IPermissionsManager.js";
import { Ruling } from "./Ruling.js";

/**
 * Delegates permission checks to whatever `IPermissionsManager`s are
 * registered for the resource's owning store's type (port of C#
 * `StorePermissionsManager`) — lets a store centralize policy for every
 * resource it holds rather than annotating each resource type individually.
 *
 * Delegates only to managers attached to the store's own type, excluding
 * itself: re-entering evaluation for the store would run Warehouse defaults
 * (including this manager) again and could recurse indefinitely or apply a
 * rate policy twice.
 */
export class StorePermissionsManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  private _settings: Map<string, unknown> | undefined;

  get settings(): Map<string, unknown> | undefined {
    return this._settings;
  }

  applicable(
    resource: IResource | null,
    session: AuthenticationSession | null,
    action: ActionType,
    member: MemberTemplate | null,
    inquirer?: unknown,
  ): Ruling {
    const storeInstance = resource?.instance?.store?.instance;
    const store = storeInstance?.resource;
    if (!storeInstance || !store) return Ruling.DontCare;

    const managers = storeInstance.warehouse
      .resolveResourceManagers(store.constructor as Function)
      .filter(
        (m): m is IPermissionsManager => m.managerCategory === "permissions" && m !== this,
      );

    let allowed = false;
    for (const manager of managers) {
      const ruling = manager.applicable(store, session, action, member, inquirer);
      if (ruling === Ruling.Denied) return Ruling.Denied;
      if (ruling === Ruling.Allowed) allowed = true;
    }

    return allowed ? Ruling.Allowed : Ruling.DontCare;
  }

  initialize(settings: Map<string, unknown> | undefined, _resource: IResource | null): boolean {
    this._settings = settings;
    return true;
  }
}
