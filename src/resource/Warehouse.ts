import { AsyncReply } from "../core/AsyncReply.js";
import { EventHandler } from "../core/EventHandler.js";
import type { IResource, IResourceContext, IStore } from "./IResource.js";
import { Instance } from "./Instance.js";
import { ResourceOperation } from "./ResourceOperation.js";
import { getTemplate } from "./decorators.js";
import { TypeTemplate } from "./template.js";
import { TypeDefKind, type ITypeDef } from "../data/types/ITypeDef.js";
import { LocalTypeDef } from "./typedef.js";
import { Record } from "./records.js";
import type { EnumType } from "./enums.js";

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
 * The remote URL/protocol branch of `get` (e.g. `iip://host/path`) is added with
 * the protocol layer in Phase 5; this build resolves local paths only.
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
  // eslint-disable-next-line @typescript-eslint/ban-types
  private readonly typeDefsByCtor = new Map<Function, ITypeDef>();
  private readonly typeDefsByEnum = new Map<EnumType, ITypeDef>();
  private typeDefCounter = 0;

  /** Build (cached) the type template for a resource class. */
  // eslint-disable-next-line @typescript-eslint/ban-types
  getTemplate(ctor: Function): TypeTemplate {
    return getTemplate(ctor);
  }

  /** Get (or lazily create) the type definition for a resource/record class. */
  // eslint-disable-next-line @typescript-eslint/ban-types
  getLocalTypeDefByType(ctor: Function): ITypeDef {
    const existing = this.typeDefsByCtor.get(ctor);
    if (existing) return existing;

    const template = getTemplate(ctor);
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
      new TypeTemplate(enumType.name, []),
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
      const parent = await this.get(location.slice(0, -1).join("/"));
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

  /** Resolve a resource by path (local stores only for now). */
  get<T extends IResource = IResource>(path: string): AsyncReply<T | undefined> {
    const reply = new AsyncReply<T | undefined>();
    this.queryAsync(path).then(
      (r) => reply.trigger(r as T | undefined),
      (e) => reply.triggerError(e),
    );
    return reply;
  }

  /** Resolve a resource by path, returning the raw resource. */
  query(path: string): AsyncReply<IResource | undefined> {
    return this.get(path);
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

  /** Close the warehouse: terminate all resources. */
  close(): AsyncReply<boolean> {
    const reply = new AsyncReply<boolean>();
    (async () => {
      for (const r of this.resources.values()) await r.handle(ResourceOperation.Terminate);
      this.opened = false;
    })().then(
      () => reply.trigger(true),
      (e) => reply.triggerError(e),
    );
    return reply;
  }

  /** Remove a resource from the warehouse. */
  remove(resource: IResource): boolean {
    if (!resource.instance) return false;
    this.resources.delete(resource.instance.id);
    if (isStore(resource)) {
      this.stores.delete(resource);
      this.storeDisconnected.emit(resource);
    }
    return true;
  }
}
