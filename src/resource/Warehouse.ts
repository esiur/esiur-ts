import { AsyncReply } from "../core/AsyncReply.js";
import { EventHandler } from "../core/EventHandler.js";
import type { IResource, IResourceContext, IStore } from "./IResource.js";
import { Instance } from "./Instance.js";
import { ResourceOperation } from "./ResourceOperation.js";
import { getRemoteInfo, getTypeDef } from "./decorators.js";
import { TypeDef } from "./template.js";
import { TypeDefKind, type ITypeDef } from "../data/types/ITypeDef.js";
import { LocalTypeDef } from "./typedef.js";
import { Record } from "./records.js";
import type { EnumType } from "./enums.js";
import { EpConnection, type EpConnectionOptions } from "../protocol/EpConnection.js";
import type { EpResourceConstructor } from "../protocol/EpResource.js";
import type { IAuthenticationProvider } from "../security/IAuthenticationProvider.js";
import type { IEncryptionProvider } from "../security/cryptography/IEncryptionProvider.js";
import { getResourceManagerTypes } from "./decorators.js";
import type { IResourceManager } from "../security/management/IResourceManager.js";
import type { IPermissionsManager } from "../security/permissions/IPermissionsManager.js";
import type { IRateControlManager } from "../security/management/IRateControlManager.js";
import type { IAuditingManager } from "../security/management/IAuditingManager.js";
import type { ResourceManagerContext } from "../security/management/ResourceManagerContext.js";
import { ResourceManagerEvaluation } from "../security/management/ResourceManagerEvaluation.js";
import { ActionType } from "../security/permissions/ActionType.js";
import { Ruling } from "../security/permissions/Ruling.js";
import type { RatePolicy } from "../security/ratelimiting/RatePolicy.js";
import { NamedRateControlManager } from "../security/ratelimiting/NamedRateControlManager.js";

export interface WarehouseRemoteGetOptions extends EpConnectionOptions {
  /** TypeDef for the remote resource proxy. Required when the URL includes a resource path. */
  typeDef?: TypeDef;
  /** @deprecated Use {@link typeDef}. */
  template?: TypeDef;
  /** Resource/stub constructor used to derive {@link typeDef}. */
  type?: Function | EpResourceConstructor;
}

export type WarehouseGetOptions =
  | WarehouseRemoteGetOptions
  | TypeDef
  | Function;

/** Duck-typed check for an {@link IStore}. */
function isStore(resource: IResource): resource is IStore {
  const s = resource as Partial<IStore>;
  return (
    typeof s.get === "function" &&
    typeof s.put === "function" &&
    typeof s.link === "function" &&
    typeof s.modify === "function"
  );
}

/**
 * Central resource manager (port of C# `Warehouse`). Holds stores and active
 * resources, resolves `*nix`-style paths, and drives the resource lifecycle.
 *
 * `get` resolves local paths and EP URLs. A bare EP URL returns an
 * {@link EpConnection}; an EP URL with a resource path returns an attached
 * remote proxy when a TypeDef/stub type is supplied.
 */
export class Warehouse {
  static readonly default = new Warehouse();

  readonly storeConnected = new EventHandler<IStore>();
  readonly storeDisconnected = new EventHandler<IStore>();

  private readonly resources = new Map<number, IResource>();
  private readonly stores = new Set<IStore>();
  private resourceCounter = 0;
  private opened = false;

  private readonly typeDefs = new Map<number, ITypeDef>();
  private readonly typeDefsByCtor = new Map<Function, ITypeDef>();
  private readonly typeDefsByEnum = new Map<EnumType, ITypeDef>();
  private typeDefCounter = 0;
  private readonly authenticationProviders = new Map<string, IAuthenticationProvider>();
  private readonly encryptionProviders = new Map<string, IEncryptionProvider>();
  private readonly resourceManagers = new Map<Function, IResourceManager>();
  private readonly defaultResourceManagerTypes = new Set<Function>();
  private readonly ratePolicies = new Map<string, RatePolicy>();
  private readonly proxyTypes = new Map<string, Function>();

  constructor() {
    // Built in and always-on, matching dotnet's own Warehouse construction —
    // bridges `@RateControl(name)`-tagged members into the named rate-policy
    // registry (see `addRatePolicy`/`tryGetRatePolicy`).
    this.registerManager(new NamedRateControlManager(), true);
  }

  /** Register an authentication provider under its default protocol name. */
  registerAuthenticationProvider(provider: IAuthenticationProvider): void;
  /** Register an authentication provider under an explicit protocol name. */
  registerAuthenticationProvider(name: string, provider: IAuthenticationProvider): void;
  registerAuthenticationProvider(
    nameOrProvider: string | IAuthenticationProvider,
    provider?: IAuthenticationProvider,
  ): void {
    const name = typeof nameOrProvider === "string" ? nameOrProvider : nameOrProvider.defaultName;
    const resolved = provider ?? (nameOrProvider as IAuthenticationProvider);
    this.authenticationProviders.set(name, resolved);
  }

  /** .NET-compatible alias for {@link registerAuthenticationProvider}. */
  RegisterAuthenticationProvider(provider: IAuthenticationProvider): void;
  /** .NET-compatible alias for {@link registerAuthenticationProvider}. */
  RegisterAuthenticationProvider(name: string, provider: IAuthenticationProvider): void;
  RegisterAuthenticationProvider(
    nameOrProvider: string | IAuthenticationProvider,
    provider?: IAuthenticationProvider,
  ): void {
    if (typeof nameOrProvider === "string")
      this.registerAuthenticationProvider(nameOrProvider, provider!);
    else
      this.registerAuthenticationProvider(nameOrProvider);
  }

  /** Resolve an authentication provider by protocol name, throwing when missing. */
  getAuthenticationProvider(name: string): IAuthenticationProvider {
    const provider = this.tryGetAuthenticationProvider(name);
    if (!provider) throw new Error("Authentication provider not found.");
    return provider;
  }

  /** .NET-compatible alias for {@link getAuthenticationProvider}. */
  GetAuthenticationProvider(name: string): IAuthenticationProvider {
    return this.getAuthenticationProvider(name);
  }

  /** Try to resolve an authentication provider by protocol name. */
  tryGetAuthenticationProvider(name: string): IAuthenticationProvider | undefined {
    return this.authenticationProviders.get(name);
  }

  /** .NET-compatible alias for {@link tryGetAuthenticationProvider}. */
  TryGetAuthenticationProvider(name: string): IAuthenticationProvider | undefined {
    return this.tryGetAuthenticationProvider(name);
  }

  /** Register an encryption provider under its default protocol name. */
  registerEncryptionProvider(provider: IEncryptionProvider): void;
  /** Register an encryption provider under an explicit protocol name. */
  registerEncryptionProvider(name: string, provider: IEncryptionProvider): void;
  registerEncryptionProvider(
    nameOrProvider: string | IEncryptionProvider,
    provider?: IEncryptionProvider,
  ): void {
    const name = typeof nameOrProvider === "string" ? nameOrProvider : nameOrProvider.defaultName;
    const resolved = provider ?? (nameOrProvider as IEncryptionProvider);
    if (this.encryptionProviders.has(name))
      throw new Error(`An encryption provider named '${name}' is already registered.`);
    this.encryptionProviders.set(name, resolved);
  }

  /** .NET-compatible alias for {@link registerEncryptionProvider}. */
  RegisterEncryptionProvider(provider: IEncryptionProvider): void;
  /** .NET-compatible alias for {@link registerEncryptionProvider}. */
  RegisterEncryptionProvider(name: string, provider: IEncryptionProvider): void;
  RegisterEncryptionProvider(
    nameOrProvider: string | IEncryptionProvider,
    provider?: IEncryptionProvider,
  ): void {
    if (typeof nameOrProvider === "string") this.registerEncryptionProvider(nameOrProvider, provider!);
    else this.registerEncryptionProvider(nameOrProvider);
  }

  /** Unregister an encryption provider previously registered under `name`. */
  unregisterEncryptionProvider(name: string, provider: IEncryptionProvider): boolean {
    return this.encryptionProviders.get(name) === provider && this.encryptionProviders.delete(name);
  }

  /** Resolve an encryption provider by protocol name, throwing when missing. */
  getEncryptionProvider(name: string): IEncryptionProvider {
    const provider = this.tryGetEncryptionProvider(name);
    if (!provider) throw new Error(`No encryption provider named '${name}'.`);
    return provider;
  }

  /** .NET-compatible alias for {@link getEncryptionProvider}. */
  GetEncryptionProvider(name: string): IEncryptionProvider {
    return this.getEncryptionProvider(name);
  }

  /** Try to resolve an encryption provider by protocol name. */
  tryGetEncryptionProvider(name: string): IEncryptionProvider | undefined {
    return this.encryptionProviders.get(name);
  }

  /** .NET-compatible alias for {@link tryGetEncryptionProvider}. */
  TryGetEncryptionProvider(name: string): IEncryptionProvider | undefined {
    return this.tryGetEncryptionProvider(name);
  }

  /** Names of every registered encryption provider. */
  getEncryptionProviderNames(): string[] {
    return [...this.encryptionProviders.keys()];
  }

  /** .NET-compatible alias for {@link getEncryptionProviderNames}. */
  GetEncryptionProviderNames(): string[] {
    return this.getEncryptionProviderNames();
  }

  // ---- resource managers (permissions / rate control / auditing) --------------

  /**
   * Register a manager instance by its concrete type (port of C#
   * `RegisterManager`). Type-level `@PermissionsManager`/`@RateControlManager`/
   * `@AuditingManager` associations and `resolveResourceManagers` can only
   * reference instances registered here.
   */
  registerManager(manager: IResourceManager, useAsDefault = false): void {
    if (
      manager.managerCategory !== "permissions" &&
      manager.managerCategory !== "rateControl" &&
      manager.managerCategory !== "auditing"
    )
      throw new Error(`Manager \`${manager.constructor.name}\` does not implement a supported manager category.`);

    const managerCtor = manager.constructor as Function;
    if (this.resourceManagers.has(managerCtor))
      throw new Error(`A resource manager of type \`${managerCtor.name}\` is already registered.`);

    this.resourceManagers.set(managerCtor, manager);
    if (useAsDefault) this.defaultResourceManagerTypes.add(managerCtor);
  }

  /** Compatibility registration for Warehouse-wide permissions (registered managers default to on). */
  registerPermissionsManager(manager: IPermissionsManager, useAsDefault = true): void {
    this.registerManager(manager, useAsDefault);
  }

  registerRateControlManager(manager: IRateControlManager, useAsDefault = false): void {
    this.registerManager(manager, useAsDefault);
  }

  registerAuditingManager(manager: IAuditingManager, useAsDefault = false): void {
    this.registerManager(manager, useAsDefault);
  }

  /** Enable/disable a registered manager as a Warehouse-wide default. Multiple defaults per category are allowed. */
  setDefaultManager(managerCtor: Function, enabled = true): void {
    if (!this.resourceManagers.has(managerCtor))
      throw new Error(`Resource manager \`${managerCtor.name}\` is not registered.`);
    if (!enabled && managerCtor === NamedRateControlManager)
      throw new Error("The built-in named rate-control manager cannot be disabled.");

    if (enabled) this.defaultResourceManagerTypes.add(managerCtor);
    else this.defaultResourceManagerTypes.delete(managerCtor);
  }

  tryGetManager<T extends IResourceManager = IResourceManager>(managerCtor: Function): T | undefined {
    return this.resourceManagers.get(managerCtor) as T | undefined;
  }

  removeManager(managerCtor: Function): boolean {
    if (managerCtor === NamedRateControlManager) return false;
    this.defaultResourceManagerTypes.delete(managerCtor);
    return this.resourceManagers.delete(managerCtor);
  }

  getDefaultManagers(): IResourceManager[] {
    return [...this.defaultResourceManagerTypes]
      .map((ctor) => this.resourceManagers.get(ctor))
      .filter((m): m is IResourceManager => m != null);
  }

  private isRegisteredManager(manager: IResourceManager): boolean {
    return this.resourceManagers.get(manager.constructor as Function) === manager;
  }

  /** Resolve the managers a resource type declared via `@PermissionsManager`/`@RateControlManager`/`@AuditingManager`. */
  resolveResourceManagers(resourceCtor: Function): IResourceManager[] {
    const resolved: IResourceManager[] = [];
    for (const managerCtor of getResourceManagerTypes(resourceCtor)) {
      const manager = this.tryGetManager(managerCtor);
      if (!manager)
        throw new Error(
          `Resource manager \`${managerCtor.name}\` declared by \`${resourceCtor.name}\` is not registered.`,
        );
      if (!resolved.includes(manager)) resolved.push(manager);
    }
    return resolved;
  }

  /**
   * Ask every applicable manager, using independent deny-overrides
   * aggregation for permissions/rate-control/auditing (port of C#
   * `EvaluateManagers`). When `managers` isn't supplied, resolves them from
   * the target resource's type (dotnet also folds in per-instance managers
   * via `Instance.Managers`; this port has no per-instance manager override
   * concept, only the type-level `@...Manager` decorators).
   */
  evaluateManagers(
    context: ResourceManagerContext,
    managers?: Iterable<IResourceManager>,
  ): ResourceManagerEvaluation {
    const local = managers
      ? [...managers]
      : context.resource
        ? this.resolveResourceManagers(context.resource.constructor as Function)
        : [];

    const combined: IResourceManager[] = [];
    for (const manager of [...this.getDefaultManagers(), ...local])
      if (manager && !combined.includes(manager)) combined.push(manager);

    let permissionsAllowed = false;
    let permissionsDenied = false;
    let rateAllowed = false;
    let rateDenied = false;
    let auditingAllowed = false;
    let auditingDenied = false;
    let delay = 0;
    let permissionsReason: string | undefined;
    let rateReason: string | undefined;
    let auditingReason: string | undefined;

    for (const manager of combined) {
      context.delay = 0;
      context.denialReason = undefined;

      try {
        if (!this.isRegisteredManager(manager))
          throw new Error(`Resource manager \`${manager.constructor.name}\` is not registered with this Warehouse.`);

        if (manager.managerCategory === "permissions") {
          const ruling = (manager as IPermissionsManager).applicable(
            context.resource,
            context.session,
            context.action,
            context.member,
            context.inquirer,
          );
          permissionsDenied ||= ruling === Ruling.Denied;
          permissionsAllowed ||= ruling === Ruling.Allowed;
          if (ruling === Ruling.Denied && permissionsReason == null)
            permissionsReason =
              context.denialReason ?? `Permissions manager \`${manager.constructor.name}\` denied the operation.`;
        } else if (manager.managerCategory === "rateControl") {
          const ruling = (manager as IRateControlManager).applicable(context);
          rateDenied ||= ruling === Ruling.Denied;
          rateAllowed ||= ruling === Ruling.Allowed;
          if (context.delay > delay) delay = context.delay;
          if (ruling === Ruling.Denied && rateReason == null)
            rateReason =
              context.denialReason ?? `Rate-control manager \`${manager.constructor.name}\` denied the operation.`;
        } else if (manager.managerCategory === "auditing") {
          const ruling = (manager as IAuditingManager).applicable(context);
          auditingDenied ||= ruling === Ruling.Denied;
          auditingAllowed ||= ruling === Ruling.Allowed;
          if (ruling === Ruling.Denied && auditingReason == null)
            auditingReason =
              context.denialReason ?? `Auditing manager \`${manager.constructor.name}\` denied the operation.`;
        }
      } catch (error) {
        if (manager.managerCategory === "permissions") {
          permissionsDenied = true;
          permissionsReason ??= "A permissions manager failed while evaluating the operation.";
        } else if (manager.managerCategory === "rateControl") {
          rateDenied = true;
          rateReason ??= "A rate-control manager failed while evaluating the operation.";
        } else if (manager.managerCategory === "auditing") {
          auditingDenied = true;
          auditingReason ??= "An auditing manager failed while evaluating the operation.";
        }
        void error;
      }
    }

    const permissions = permissionsDenied
      ? Ruling.Denied
      : permissionsAllowed
        ? Ruling.Allowed
        : defaultPermissions(context.action);
    const rateControl = rateDenied ? Ruling.Denied : rateAllowed ? Ruling.Allowed : Ruling.DontCare;
    const auditing = auditingDenied ? Ruling.Denied : auditingAllowed ? Ruling.Allowed : Ruling.DontCare;

    context.delay = delay;
    context.denialReason =
      permissions === Ruling.Denied ? permissionsReason : auditing === Ruling.Denied ? auditingReason : rateReason;

    return new ResourceManagerEvaluation(
      permissions,
      rateControl,
      auditing,
      delay,
      permissionsReason,
      rateReason,
      auditingReason,
    );
  }

  /** Register a named rate policy referenced by `@RateControl(name)`. */
  addRatePolicy(policy: RatePolicy): void;
  addRatePolicy(name: string, policy: RatePolicy): void;
  addRatePolicy(nameOrPolicy: string | RatePolicy, policy?: RatePolicy): void {
    const resolved = typeof nameOrPolicy === "string" ? policy! : nameOrPolicy;
    if (typeof nameOrPolicy === "string") resolved.name = nameOrPolicy;
    if (!resolved.name?.trim()) throw new Error("The rate policy must have a name.");
    if (this.ratePolicies.has(resolved.name))
      throw new Error(`A rate policy named \`${resolved.name}\` is already registered.`);
    this.ratePolicies.set(resolved.name, resolved);
  }

  tryGetRatePolicy(name: string): RatePolicy | undefined {
    return name?.trim() ? this.ratePolicies.get(name) : undefined;
  }

  removeRatePolicy(name: string): boolean {
    return name?.trim() ? this.ratePolicies.delete(name) : false;
  }

  /** Register a generated remote proxy type for automatic EpResource attachment. */
  registerProxyType(type: Function): void {
    const registration = getProxyRegistration(type);
    const domains = registration.domains.length > 0 ? registration.domains : [""];
    for (const domain of domains)
      this.proxyTypes.set(proxyKey(registration.kind, domain, registration.name), type);
  }

  /** .NET-compatible alias for {@link registerProxyType}. */
  RegisterProxyType(type: Function): void {
    this.registerProxyType(type);
  }

  /** Register multiple generated remote proxy types. */
  registerProxyTypes(types: Iterable<Function>): void {
    for (const type of types) this.registerProxyType(type);
  }

  /** .NET-compatible alias for {@link registerProxyTypes}. */
  RegisterProxyTypes(types: Iterable<Function>): void {
    this.registerProxyTypes(types);
  }

  /** Resolve a registered generated proxy type by kind, domain and remote TypeDef name. */
  tryGetProxyType(kind: TypeDefKind, domain: string, name: string): Function | undefined {
    const exact = this.proxyTypes.get(proxyKey(kind, domain, name));
    if (exact) return exact;

    const wildcard = this.proxyTypes.get(proxyKey(kind, "*", name));
    if (wildcard) return wildcard;

    const domainless = this.proxyTypes.get(proxyKey(kind, "", name));
    if (domainless) return domainless;

    const suffix = `|${kind}|${name}`;
    for (const [key, type] of this.proxyTypes)
      if (key.endsWith(suffix)) return type;
    return undefined;
  }

  /** .NET-compatible alias for {@link tryGetProxyType}. */
  TryGetProxyType(kind: TypeDefKind, domain: string, name: string): Function | undefined {
    return this.tryGetProxyType(kind, domain, name);
  }

  /** Resolve a registered generated proxy type or throw when missing. */
  getProxyType(kind: TypeDefKind, domain: string, name: string): Function {
    const type = this.tryGetProxyType(kind, domain, name);
    if (!type) throw new Error(`No proxy type registered for '${name}' in '${domain}'.`);
    return type;
  }

  /** .NET-compatible alias for {@link getProxyType}. */
  GetProxyType(kind: TypeDefKind, domain: string, name: string): Function {
    return this.getProxyType(kind, domain, name);
  }

  /** Build (cached) the decorated TypeDef surface for a resource class. */
  getTypeDef(ctor: Function): TypeDef {
    return getTypeDef(ctor);
  }

  /** @deprecated Use {@link getTypeDef}. */
  getTemplate(ctor: Function): TypeDef {
    return this.getTypeDef(ctor);
  }

  /** Get (or lazily create) the type definition for a resource/record class. */
  getLocalTypeDefByType(ctor: Function): ITypeDef {
    const existing = this.typeDefsByCtor.get(ctor);
    if (existing) return existing;

    const template = getTypeDef(ctor);
    const kind = (ctor.prototype instanceof Record)
      ? TypeDefKind.Record
      : TypeDefKind.Resource;
    const id = ++this.typeDefCounter;
    const typeDef = new LocalTypeDef(
      id,
      kind,
      ctor.name,
      template,
      ctor as new () => object,
    );
    this.typeDefs.set(id, typeDef);
    this.typeDefsByCtor.set(ctor, typeDef);
    return typeDef;
  }

  /** Get (or lazily create) the type definition for an enum descriptor. */
  getLocalTypeDefByEnum(enumType: EnumType): ITypeDef {
    const existing = this.typeDefsByEnum.get(enumType);
    if (existing) return existing;

    const id = ++this.typeDefCounter;
    const typeDef = new LocalTypeDef(
      id,
      TypeDefKind.Enum,
      enumType.name,
      new TypeDef(enumType.name, []),
      undefined,
      enumType.constants,
    );
    this.typeDefs.set(id, typeDef);
    this.typeDefsByEnum.set(enumType, typeDef);
    return typeDef;
  }

  /** Resolve a type definition by its numeric id. */
  getLocalTypeDefById(id: number): ITypeDef {
    const td = this.typeDefs.get(id);
    if (!td) throw new Error(`TypeDef ${id} not found.`);
    return td;
  }

  /** Resolve a type definition registered on this warehouse by its class name. */
  getLocalTypeDefByName(name: string): ITypeDef | undefined {
    for (const td of this.typeDefs.values()) if (td.name === name) return td;
    return undefined;
  }

  /** Look up an active resource by its numeric instance id. */
  getById(id: number): IResource | undefined {
    return this.resources.get(id);
  }

  /** Put a resource (or store) at `path` and initialize it. */
  put<T extends IResource>(path: string, resource: T, context?: IResourceContext): AsyncReply<T> {
    const reply = new AsyncReply<T>();
    this.putAsync(path, resource, context).then(
      (r) => reply.trigger(r),
      (e) => reply.triggerError(e),
    );
    return reply;
  }

  private async putAsync<T extends IResource>(
    path: string,
    resource: T,
    context?: IResourceContext,
  ): Promise<T> {
    if (resource.instance) throw new Error("Resource already initialized.");
    if (!path) throw new Error("Invalid path.");

    const location = path.replace(/^\/+/, "").split("/");
    const instanceName = location[location.length - 1];

    let store: IStore;
    if (location.length === 1) {
      if (!isStore(resource))
        throw new Error("Resource is not a store; a root-level path is not allowed.");
      store = resource;
    } else {
      const parent = await this.query(location.slice(0, -1).join("/"));
      if (!parent) throw new Error("Can't find parent.");
      store = parent.instance!.store;
    }

    const id = ++this.resourceCounter;
    resource.instance = new Instance(this, id, instanceName, resource, store, context?.age ?? 0);

    if (isStore(resource)) {
      this.stores.add(resource);
    } else if ((resource as IResource) !== (store as IResource)) {
      const ok = await store.put(resource, location.slice(1).join("/"));
      if (!ok) throw new Error("Store failed to put the resource.");
    }

    this.resources.set(id, resource);

    if (this.opened) {
      await resource.handle(ResourceOperation.Initialize, context);
      if (isStore(resource)) await resource.handle(ResourceOperation.Open, context);
    }

    if (isStore(resource)) this.storeConnected.emit(resource);
    return resource;
  }

  /**
   * Resolve a local resource path or an EP URL. `ep://host:port` returns an
   * {@link EpConnection}; `ep://host:port/path` returns an attached remote proxy
   * when `options` supplies a {@link TypeDef} or resource/stub constructor.
   */
  get<T = IResource>(
    path: string,
    options?: WarehouseGetOptions,
  ): AsyncReply<T | EpConnection | undefined> {
    const reply = new AsyncReply<T | EpConnection | undefined>();
    this.getAsync<T>(path, options).then(
      (r) => reply.trigger(r),
      (e) => reply.triggerError(e),
    );
    return reply;
  }

  /** .NET-compatible alias for {@link get}. */
  Get<T = IResource>(
    path: string,
    options?: WarehouseGetOptions,
  ): AsyncReply<T | EpConnection | undefined> {
    return this.get<T>(path, options);
  }

  /** Resolve a resource by path, returning the raw resource. */
  query(path: string): AsyncReply<IResource | undefined> {
    const reply = new AsyncReply<IResource | undefined>();
    this.queryAsync(path).then(
      (r) => reply.trigger(r),
      (e) => reply.triggerError(e),
    );
    return reply;
  }

  private async getAsync<T>(
    path: string,
    options?: WarehouseGetOptions,
  ): Promise<T | EpConnection | undefined> {
    const remote = parseRemoteEpUrl(path);
    if (remote) {
      if (!this.opened) await this.open();

      const remoteOptions = normalizeRemoteOptions(options, this);
      const connection = await EpConnection.connect(remote.socketUrl, this, remoteOptions);
      if (!remote.resourcePath) return connection;

      const target = remoteOptions.type ?? remoteOptions.typeDef;
      return (await connection.get(
        remote.resourcePath,
        target as TypeDef | EpResourceConstructor | undefined,
      )) as T;
    }

    return (await this.queryAsync(path)) as T | undefined;
  }

  private async queryAsync(path: string): Promise<IResource | undefined> {
    const p = path.trim().replace(/^\/+/, "").split("/");
    for (const store of this.stores) {
      if (p[0] === store.instance?.name) {
        if (p.length === 1) return store;
        const res = await store.get(p.slice(1).join("/"));
        return res ?? undefined;
      }
    }
    return undefined;
  }

  /** Open the warehouse: initialize all resources and open all stores. */
  open(): AsyncReply<boolean> {
    const reply = new AsyncReply<boolean>();
    this.openAsync().then(
      () => reply.trigger(true),
      (e) => reply.triggerError(e),
    );
    return reply;
  }

  private async openAsync(): Promise<void> {
    this.opened = true;
    for (const r of this.resources.values()) await r.handle(ResourceOperation.Initialize);
    for (const s of this.stores) await s.handle(ResourceOperation.Open);
  }

  /**
   * Close the warehouse: terminate all resources in two fully-settled phases
   * (`Terminate` then `SystemTerminated`), matching C# `Warehouse.Close()`.
   * Each phase notifies every resource even if some throw; errors from both
   * phases are aggregated rather than aborting the remaining resources.
   */
  close(): AsyncReply<boolean> {
    const reply = new AsyncReply<boolean>();
    (async () => {
      const resources = new Set<IResource>([...this.resources.values(), ...this.stores]);
      const terminateErrors = await settleOperation(resources, ResourceOperation.Terminate);
      const systemTerminatedErrors = await settleOperation(resources, ResourceOperation.SystemTerminated);
      this.opened = false;

      const errors = [...terminateErrors, ...systemTerminatedErrors];
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, "One or more resources failed while closing the warehouse.");
    })().then(
      () => reply.trigger(true),
      (e) => reply.triggerError(e),
    );
    return reply;
  }

  /**
   * Remove a resource from the warehouse: drops it from the id/store maps,
   * tells its owning store to release it, destroys it, and clears its
   * `.instance`. Kept synchronous (matching dotnet's `Warehouse.Remove`) —
   * `MemoryStore.remove()`'s own mutation already runs synchronously despite
   * its `AsyncReply` return type, so the result isn't awaited here.
   *
   * Deferred: recursive cascade-delete of a *store* resource's own children
   * (dotnet does this too) isn't implemented — `IStore.children()` returns
   * an `AsyncBag`, making that a genuinely async, separate piece of work.
   */
  remove(resource: IResource): boolean {
    if (!resource.instance) return false;
    const store = resource.instance.store;
    this.resources.delete(resource.instance.id);
    if (isStore(resource)) {
      this.stores.delete(resource);
      this.storeDisconnected.emit(resource);
    }
    if (store && (store as unknown as IResource) !== resource) store.remove(resource);
    resource.destroy();
    resource.instance = undefined;
    return true;
  }
}

/** Dispatch `operation` to every resource, collecting (not throwing on) per-resource errors. */
async function settleOperation(
  resources: Iterable<IResource>,
  operation: ResourceOperation,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  await Promise.all(
    [...resources].map(async (r) => {
      try {
        await r.handle(operation);
      } catch (e) {
        errors.push(e);
      }
    }),
  );
  return errors;
}

/**
 * Fallback ruling when no permissions manager voted either way (port of C#
 * `Warehouse.DefaultPermissions`) — read-ish/connection-lifecycle actions
 * default to allowed for backward compatibility; mutating/administrative
 * actions default to denied (fail closed).
 */
function defaultPermissions(action: ActionType): Ruling {
  switch (action) {
    case ActionType.GetProperty:
    case ActionType.ViewTypeDef:
    case ActionType.ReceiveEvent:
    case ActionType.Attach:
    case ActionType.Execute:
    case ActionType.Detach:
    case ActionType.Subscribe:
    case ActionType.Unsubscribe:
    case ActionType.PullStream:
    case ActionType.TerminateExecution:
    case ActionType.HaltExecution:
    case ActionType.ResumeExecution:
      return Ruling.Allowed;
    default:
      return Ruling.Denied;
  }
}

interface RemoteEpUrl {
  socketUrl: string;
  resourcePath: string;
}

function parseRemoteEpUrl(path: string): RemoteEpUrl | undefined {
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return undefined;
  }

  const scheme = url.protocol.slice(0, -1).toLowerCase();
  let socketScheme: "ws" | "wss" | "tcp";
  if (scheme === "ep" || scheme === "ws") socketScheme = "ws";
  else if (scheme === "eps" || scheme === "wss") socketScheme = "wss";
  // `tcp://host:port` dials a raw TCP socket (Node-only) instead of a
  // WebSocket — for esiur-dotnet servers exposing only their native
  // `TcpServer`, with no WebSocket upgrade route.
  else if (scheme === "tcp") socketScheme = "tcp";
  else return undefined;

  const resourcePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  return {
    socketUrl: `${socketScheme}://${url.host}`,
    resourcePath,
  };
}

function normalizeRemoteOptions(
  options: WarehouseGetOptions | undefined,
  warehouse: Warehouse,
): WarehouseRemoteGetOptions {
  if (!options) return {};
  if (options instanceof TypeDef) return { typeDef: options };
  if (typeof options === "function")
    return { type: options, typeDef: getRemoteOptionTypeDef(options, warehouse) };
  const typeDef =
    options.typeDef ??
    options.template ??
    (options.type ? getRemoteOptionTypeDef(options.type, warehouse) : undefined);
  return { ...options, typeDef, template: options.template ?? typeDef };
}

function getRemoteOptionTypeDef(type: Function, warehouse: Warehouse): TypeDef | undefined {
  const statics = type as {
    typeDef?: unknown;
    TypeDef?: unknown;
    template?: unknown;
    Template?: unknown;
  };
  const explicit = statics.typeDef ?? statics.TypeDef ?? statics.template ?? statics.Template;
  if (explicit instanceof TypeDef) return explicit;

  const decorated = warehouse.getTypeDef(type);
  return decorated.members.length > 0 ? decorated : undefined;
}

interface ProxyRegistration {
  kind: TypeDefKind;
  name: string;
  domains: string[];
}

function getProxyRegistration(type: Function): ProxyRegistration {
  const remote = getRemoteInfo(type);
  const statics = type as {
    typeDef?: unknown;
    TypeDef?: unknown;
    template?: unknown;
    Template?: unknown;
    kind?: TypeDefKind;
    Kind?: TypeDefKind;
    typeDefKind?: TypeDefKind;
    TypeDefKind?: TypeDefKind;
  };
  const template = statics.typeDef ?? statics.TypeDef ?? statics.template ?? statics.Template;
  const templateName = template instanceof TypeDef ? template.className : undefined;
  const kind =
    statics.kind ??
    statics.Kind ??
    statics.typeDefKind ??
    statics.TypeDefKind ??
    (type.prototype instanceof Record ? TypeDefKind.Record : TypeDefKind.Resource);

  return {
    kind,
    name: remote?.name ?? templateName ?? type.name,
    domains: remote?.domains ?? [],
  };
}

function proxyKey(kind: TypeDefKind, domain: string, name: string): string {
  return `${domain}|${kind}|${name}`;
}
