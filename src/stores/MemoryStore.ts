import { AsyncReply } from "../core/AsyncReply.js";
import { AsyncBag } from "../core/AsyncBag.js";
import type { DestroyedEvent } from "../core/IDestructible.js";
import type { IResource, IStore } from "../resource/IResource.js";
import type { Instance } from "../resource/Instance.js";
import { ResourceOperation } from "../resource/ResourceOperation.js";

/**
 * An in-memory {@link IStore} that keeps its resources in RAM (port of C#
 * `MemoryStore`). Resources are addressed by their stored link path, or by
 * `$<id>` for a direct instance-id lookup.
 */
export class MemoryStore implements IStore {
  instance?: Instance;

  private readonly resources = new Map<number, IResource>();
  private readonly destroyHandlers: DestroyedEvent[] = [];

  handle(_operation: ResourceOperation): AsyncReply<boolean> {
    return AsyncReply.fromResult(true);
  }

  link(resource: IResource): string | undefined {
    if (resource.instance?.store === this)
      return resource.instance.variables.get("link") as string | undefined;
    return undefined;
  }

  get(path: string): AsyncReply<IResource | undefined> {
    if (path.startsWith("$")) {
      const id = Number.parseInt(path.slice(1), 10);
      if (!Number.isNaN(id)) {
        const found = this.resources.get(id);
        if (found) return AsyncReply.fromResult<IResource | undefined>(found);
      }
    } else {
      for (const r of this.resources.values())
        if (this.link(r) === path) return AsyncReply.fromResult<IResource | undefined>(r);
    }
    return AsyncReply.fromResult<IResource | undefined>(undefined);
  }

  put(resource: IResource, path: string): AsyncReply<boolean> {
    resource.instance!.variables.set("link", path);
    this.resources.set(resource.instance!.id, resource);
    return AsyncReply.fromResult(true);
  }

  modify(): boolean {
    return true;
  }

  remove(resource: IResource): AsyncReply<boolean>;
  remove(path: string): AsyncReply<boolean>;
  remove(resourceOrPath: IResource | string): AsyncReply<boolean> {
    if (typeof resourceOrPath === "string") {
      const path = normalizeStorePath(resourceOrPath, this.instance?.name);
      for (const r of this.resources.values()) {
        if (this.link(r) === path) {
          this.resources.delete(r.instance!.id);
          return AsyncReply.fromResult(true);
        }
      }
      return AsyncReply.fromResult(false);
    }

    if (resourceOrPath.instance?.store !== this) return AsyncReply.fromResult(false);
    return AsyncReply.fromResult(this.resources.delete(resourceOrPath.instance.id));
  }

  move(resource: IResource, newPath: string): AsyncReply<boolean> {
    if (resource.instance?.store !== this) return AsyncReply.fromResult(false);

    const path = normalizeStorePath(newPath, this.instance?.name);
    resource.instance.variables.set("link", path);

    const parts = path.split("/").filter((p) => p.length > 0);
    if (parts.length > 0) resource.instance.name = parts[parts.length - 1];

    return AsyncReply.fromResult(true);
  }

  children<T extends IResource>(resource: IResource): AsyncBag<T> {
    const prefix = `${this.link(resource)}/`;
    const matches = [...this.resources.values()].filter((r) => {
      const link = this.link(r);
      return link != null && link.startsWith(prefix);
    });
    return new AsyncBag<T>(matches as T[]);
  }

  parents<T extends IResource>(): AsyncBag<T> {
    return new AsyncBag<T>([]);
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

function normalizeStorePath(path: string, storeName?: string): string {
  const normalized = path.trim().replace(/^\/+|\/+$/g, "");
  if (!storeName) return normalized;
  if (normalized === storeName) return "";
  const prefix = `${storeName}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}
