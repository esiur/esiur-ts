import { AsyncReply } from "../core/AsyncReply.js";
import type { DestroyedEvent } from "../core/IDestructible.js";
import { ResourceOperation } from "./ResourceOperation.js";
import type { IResource, IResourceContext } from "./IResource.js";
import type { Instance } from "./Instance.js";

/**
 * Convenience base class for resources (port of C# `Resource`). Provides the
 * {@link Instance} slot, lifecycle `handle`, and destroy notification, so a
 * subclass need only declare its `@Export`ed members.
 */
export class Resource implements IResource {
  instance?: Instance;

  private readonly destroyHandlers: DestroyedEvent[] = [];

  handle(operation: ResourceOperation, _context?: IResourceContext): AsyncReply<boolean> {
    if (operation === ResourceOperation.Initialize)
      return AsyncReply.fromResult(this.create());
    return AsyncReply.fromResult(true);
  }

  /** Override to run setup logic on Initialize; return false to fail the put. */
  protected create(): boolean {
    return true;
  }

  addDestroyHandler(handler: DestroyedEvent): void {
    this.destroyHandlers.push(handler);
  }

  removeDestroyHandler(handler: DestroyedEvent): void {
    const i = this.destroyHandlers.indexOf(handler);
    if (i >= 0) this.destroyHandlers.splice(i, 1);
  }

  destroy(): void {
    for (const h of this.destroyHandlers.slice()) h(this);
  }
}
