import { describe, it, expect, vi } from "vitest";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export, PermissionsManager, RateControl } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { ActionType } from "../../src/security/permissions/ActionType.js";
import { Ruling } from "../../src/security/permissions/Ruling.js";
import type { IPermissionsManager } from "../../src/security/permissions/IPermissionsManager.js";
import type { IAuditingManager } from "../../src/security/management/IAuditingManager.js";
import { ResourceManagerContext } from "../../src/security/management/ResourceManagerContext.js";
import { UserPermissionsManager } from "../../src/security/permissions/UserPermissionsManager.js";
import { BurstRatePolicy } from "../../src/security/ratelimiting/BurstRatePolicy.js";
import { RateControlContext } from "../../src/security/ratelimiting/RatePolicy.js";
import type { AuthenticationSession } from "../../src/security/AuthenticationSession.js";
import type { EpConnection } from "../../src/protocol/EpConnection.js";

class AllowManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  readonly settings = undefined;
  applicable = vi.fn((): Ruling => Ruling.Allowed);
  initialize(): boolean {
    return true;
  }
}

class DenyManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  readonly settings = undefined;
  applicable = vi.fn((): Ruling => Ruling.Denied);
  initialize(): boolean {
    return true;
  }
}

class VetoAuditingManager implements IAuditingManager {
  readonly managerCategory = "auditing" as const;
  applicable(context: ResourceManagerContext): Ruling {
    context.denialReason = "vetoed by audit";
    return Ruling.Denied;
  }
}

function fakeSession(remoteIdentity: string | null = "alice"): AuthenticationSession {
  return {
    authenticationMode: 0,
    localHeaders: new Map(),
    remoteHeaders: new Map(),
    localIdentity: null,
    remoteIdentity,
    key: null,
    authenticated: true,
    variables: new Map(),
    encryptionMode: 0,
    encryptionProvider: null,
    symetricCipher: null,
    encryptionActive: false,
  };
}

class PlainResource extends Resource {
  @Export(t.i32) accessor value = 0;
}

describe("Warehouse resource-manager registry", () => {
  it("registers, looks up, and removes managers by constructor", () => {
    const wh = new Warehouse();
    const manager = new AllowManager();
    wh.registerManager(manager);

    expect(wh.tryGetManager(AllowManager)).toBe(manager);
    expect(wh.tryGetManager(DenyManager)).toBeUndefined();
    expect(wh.removeManager(AllowManager)).toBe(true);
    expect(wh.tryGetManager(AllowManager)).toBeUndefined();
  });

  it("rejects registering the same manager type twice", () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowManager());
    expect(() => wh.registerManager(new AllowManager())).toThrow(/already registered/);
  });

  it("setDefaultManager toggles membership in getDefaultManagers", () => {
    const wh = new Warehouse();
    const manager = new AllowManager();
    wh.registerManager(manager, false);
    expect(wh.getDefaultManagers()).not.toContain(manager);

    wh.setDefaultManager(AllowManager, true);
    expect(wh.getDefaultManagers()).toContain(manager);

    wh.setDefaultManager(AllowManager, false);
    expect(wh.getDefaultManagers()).not.toContain(manager);
  });

  it("the built-in NamedRateControlManager cannot be disabled or removed", () => {
    const wh = new Warehouse();
    const [namedRateControlManagerCtor] = wh.getDefaultManagers().map((m) => m.constructor);
    expect(namedRateControlManagerCtor.name).toBe("NamedRateControlManager");
    expect(() => wh.setDefaultManager(namedRateControlManagerCtor, false)).toThrow(/cannot be disabled/);
    expect(wh.removeManager(namedRateControlManagerCtor)).toBe(false);
  });

  it("resolveResourceManagers reads @PermissionsManager class associations", () => {
    const wh = new Warehouse();
    const manager = new AllowManager();
    wh.registerManager(manager);

    @PermissionsManager(AllowManager)
    class Annotated extends Resource {}

    expect(wh.resolveResourceManagers(Annotated)).toEqual([manager]);
  });

  it("resolveResourceManagers throws when the declared manager type isn't registered", () => {
    const wh = new Warehouse();

    @PermissionsManager(AllowManager)
    class Annotated extends Resource {}

    expect(() => wh.resolveResourceManagers(Annotated)).toThrow(/is not registered/);
  });
});

describe("Warehouse.evaluateManagers", () => {
  it("denies SetProperty by default when no permissions manager is configured (matches dotnet's DefaultPermissions)", () => {
    const wh = new Warehouse();
    const context = new ResourceManagerContext(wh, null, fakeSession(), null, null, ActionType.SetProperty);
    expect(wh.evaluateManagers(context).isAllowed).toBe(false);
  });

  it("allows GetProperty-like actions by default when no permissions manager is configured", () => {
    const wh = new Warehouse();
    const context = new ResourceManagerContext(wh, null, fakeSession(), null, null, ActionType.GetProperty);
    expect(wh.evaluateManagers(context).isAllowed).toBe(true);
  });

  it("an explicit Allow from a default permissions manager admits an otherwise-denied action", () => {
    const wh = new Warehouse();
    const manager = new AllowManager();
    wh.registerManager(manager, true);
    const context = new ResourceManagerContext(wh, null, fakeSession(), null, null, ActionType.SetProperty);

    const evaluation = wh.evaluateManagers(context);
    expect(evaluation.isAllowed).toBe(true);
    expect(manager.applicable).toHaveBeenCalledTimes(1);
  });

  it("a Deny always wins over an Allow within the same category", () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowManager(), true);
    wh.registerManager(new DenyManager(), true);
    const context = new ResourceManagerContext(wh, null, fakeSession(), null, null, ActionType.GetProperty);
    expect(wh.evaluateManagers(context).isAllowed).toBe(false);
  });

  it("an auditing veto denies even when permissions allow", () => {
    const wh = new Warehouse();
    wh.registerManager(new AllowManager(), true);
    wh.registerManager(new VetoAuditingManager(), true);
    const context = new ResourceManagerContext(wh, null, fakeSession(), null, null, ActionType.Execute);

    const evaluation = wh.evaluateManagers(context);
    expect(evaluation.isAllowed).toBe(false);
    expect(evaluation.auditingDenialReason).toBe("vetoed by audit");
  });

  it("a manager that throws fails its category closed without crashing evaluation", () => {
    const wh = new Warehouse();
    class ThrowingManager implements IPermissionsManager {
      readonly managerCategory = "permissions" as const;
      readonly settings = undefined;
      applicable(): Ruling {
        throw new Error("boom");
      }
      initialize(): boolean {
        return true;
      }
    }
    wh.registerManager(new ThrowingManager(), true);
    const context = new ResourceManagerContext(wh, null, fakeSession(), null, null, ActionType.GetProperty);
    expect(wh.evaluateManagers(context).isAllowed).toBe(false);
  });
});

describe("UserPermissionsManager", () => {
  it("denies when there is no session or no matching identity/public entry", () => {
    const manager = new UserPermissionsManager(new Map());
    expect(manager.applicable(null, null, ActionType.Attach, null)).toBe(Ruling.Denied);
    expect(manager.applicable(null, fakeSession("bob"), ActionType.Attach, null)).toBe(Ruling.Denied);
  });

  it("allows a resource-level action via the identity's permission key", () => {
    const manager = new UserPermissionsManager(
      new Map([["alice", new Map([["_attach", "yes"]])]]),
    );
    expect(manager.applicable(null, fakeSession("alice"), ActionType.Attach, null)).toBe(Ruling.Allowed);
  });

  it("falls back to the public entry when there is no identity-specific one", () => {
    const manager = new UserPermissionsManager(new Map([["public", new Map([["_attach", "yes"]])]]));
    expect(manager.applicable(null, fakeSession("anyone"), ActionType.Attach, null)).toBe(Ruling.Allowed);
  });

  it("member-level access is fail closed for an action with no configured entry", () => {
    const manager = new UserPermissionsManager(new Map([["alice", new Map()]]));
    const member = { memberType: 1, name: "value", index: 0 } as unknown as import("../../src/resource/template.js").PropertyTemplate;
    expect(manager.applicable(null, fakeSession("alice"), ActionType.SetProperty, member)).toBe(Ruling.Denied);
  });
});

describe("BurstRatePolicy", () => {
  it("allows up to the permit limit, then denies without a queue", () => {
    const policy = new BurstRatePolicy("test");
    policy.permitLimit = 2;
    policy.period = 1000;
    policy.queueLimit = 0;

    const connection = {} as EpConnection;
    const member = { name: "greet" } as unknown as import("../../src/resource/template.js").MemberTemplate;
    const makeContext = () =>
      new RateControlContext(
        new Warehouse(),
        connection,
        fakeSession(),
        null,
        member,
        ActionType.Execute,
      );

    expect(policy.applicable(makeContext())).toBe(Ruling.Allowed);
    expect(policy.applicable(makeContext())).toBe(Ruling.Allowed);
    expect(policy.applicable(makeContext())).toBe(Ruling.Denied);
  });

  it("scopes buckets per connection: a fresh connection has its own budget", () => {
    const policy = new BurstRatePolicy("test");
    policy.permitLimit = 1;
    policy.queueLimit = 0;

    const member = { name: "greet" } as unknown as import("../../src/resource/template.js").MemberTemplate;
    const connectionA = {} as EpConnection;
    const connectionB = {} as EpConnection;
    const wh = new Warehouse();

    expect(
      policy.applicable(new RateControlContext(wh, connectionA, fakeSession(), null, member, ActionType.Execute)),
    ).toBe(Ruling.Allowed);
    expect(
      policy.applicable(new RateControlContext(wh, connectionA, fakeSession(), null, member, ActionType.Execute)),
    ).toBe(Ruling.Denied);
    expect(
      policy.applicable(new RateControlContext(wh, connectionB, fakeSession(), null, member, ActionType.Execute)),
    ).toBe(Ruling.Allowed);
  });
});

describe("@RateControl + NamedRateControlManager", () => {
  it("denies Execute once the named policy's budget is exhausted", () => {
    const wh = new Warehouse();

    class Throttled extends Resource {
      @Export(t.string, [t.string])
      @RateControl("throttled-policy")
      greet(name: string): string {
        return `hi ${name}`;
      }
    }

    const policy = new BurstRatePolicy("throttled-policy");
    policy.permitLimit = 1;
    policy.queueLimit = 0;
    wh.addRatePolicy(policy);

    const typeDef = wh.getTypeDef(Throttled);
    const member = typeDef.getFunctionByName("greet")!;
    expect(member.ratePolicyName).toBe("throttled-policy");

    const connection = {} as EpConnection;
    const makeContext = () =>
      new ResourceManagerContext(wh, connection, fakeSession(), null, member, ActionType.Execute);

    // First call consumes the only permit and is admitted (rate control DontCare/Allowed, no permissions manager -> default-allow for Execute).
    expect(wh.evaluateManagers(makeContext()).isAllowed).toBe(true);
    // Second call is denied by rate control.
    expect(wh.evaluateManagers(makeContext()).isAllowed).toBe(false);
  });

  it("is a no-op (DontCare) for members without a rate policy", () => {
    const wh = new Warehouse();
    class Plain extends Resource {
      @Export(t.string, [t.string])
      greet(name: string): string {
        return `hi ${name}`;
      }
    }
    const typeDef = wh.getTypeDef(Plain);
    const member = typeDef.getFunctionByName("greet")!;
    const connection = {} as EpConnection;
    const context = new ResourceManagerContext(wh, connection, fakeSession(), null, member, ActionType.Execute);
    expect(wh.evaluateManagers(context).isAllowed).toBe(true);
  });
});

describe("StorePermissionsManager-style store scoping (sanity)", () => {
  it("a resource put into a MemoryStore keeps a working instance chain for manager resolution", async () => {
    const wh = new Warehouse();
    await wh.put("sys", new MemoryStore());
    const resource = await wh.put("sys/thing", new PlainResource());
    await wh.open();

    expect(resource.instance?.store).toBeDefined();
    expect(resource.instance?.warehouse).toBe(wh);
  });
});
