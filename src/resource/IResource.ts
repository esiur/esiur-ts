import type { AsyncReply } from "../core/AsyncReply.js";
import type { AsyncBag } from "../core/AsyncBag.js";
import type { IDestructible } from "../core/IDestructible.js";
import type { Instance } from "./Instance.js";
import type { PropertyTemplate } from "./template.js";
import type { ResourceOperation } from "./ResourceOperation.js";

/** Optional context passed when putting/getting a resource. */
export interface IResourceContext {
  age?: number;
  attributes?: Map<string, unknown>;
}

/** A distributable resource (port of C# `IResource`). */
export interface IResource extends IDestructible {
  /** The managing {@link Instance}; assigned by the {@link Warehouse} on put. */
  instance?: Instance;
  /** Handle a lifecycle operation. */
  handle(operation: ResourceOperation, context?: IResourceContext): AsyncReply<boolean>;
}

/** A resource that stores and retrieves other resources (port of C# `IStore`). */
export interface IStore extends IResource {
  get(path: string): AsyncReply<IResource | undefined>;
  put(resource: IResource, path: string): AsyncReply<boolean>;
  link(resource: IResource): string | undefined;
  modify(
    resource: IResource,
    property: PropertyTemplate,
    value: unknown,
    age: number | undefined,
    date: Date | undefined,
  ): boolean;
  remove(resource: IResource): AsyncReply<boolean>;
  remove(path: string): AsyncReply<boolean>;
  move(resource: IResource, newPath: string): AsyncReply<boolean>;
  children<T extends IResource>(resource: IResource, name?: string): AsyncBag<T>;
  parents<T extends IResource>(resource: IResource, name?: string): AsyncBag<T>;
}
