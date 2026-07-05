import { EventHandler } from "../core/EventHandler.js";
import type { IResource, IStore } from "./IResource.js";
import type { Warehouse } from "./Warehouse.js";
import type { TypeDef, PropertyTemplate, EventTemplate } from "./template.js";
import { EventSource } from "./decorators.js";

/** Payload for {@link Instance.propertyModified}. */
export interface PropertyModificationInfo {
  resource: IResource;
  property: PropertyTemplate;
  value: unknown;
  age: number;
}

/** Payload for {@link Instance.eventOccurred}. */
export interface EventOccurredInfo {
  resource: IResource;
  event: EventTemplate;
  value: unknown;
}

/**
 * Manages a resource's identity and state (port of C# `Instance`): id, name,
 * owning store, TypeDef, per-property age/modification date, and the
 * property-change / event notification channels.
 */
export class Instance {
  readonly warehouse: Warehouse;
  readonly id: number;
  name: string;
  readonly definition: TypeDef;
  readonly variables = new Map<string, unknown>();

  readonly propertyModified = new EventHandler<PropertyModificationInfo>();
  readonly eventOccurred = new EventHandler<EventOccurredInfo>();
  readonly destroyed = new EventHandler<IResource>();

  isDestroyed = false;

  private readonly store_: IStore;
  private readonly resourceRef: WeakRef<IResource>;
  private readonly ages: number[] = [];
  private readonly modificationDates: Array<Date | undefined> = [];
  private instanceAge: number;
  private loading = false;

  constructor(
    warehouse: Warehouse,
    id: number,
    name: string,
    resource: IResource,
    store: IStore,
    age = 0,
  ) {
    this.warehouse = warehouse;
    this.id = id;
    this.name = name ?? "";
    this.store_ = store;
    this.resourceRef = new WeakRef(resource);
    this.instanceAge = age;
    this.definition = warehouse.getTypeDef(resource.constructor);

    for (let i = 0; i < this.definition.properties.length; i++) {
      this.ages.push(0);
      this.modificationDates.push(undefined);
    }

    // Forward exported events raised by the resource through this instance.
    for (const evt of this.definition.events) {
      const src = (resource as unknown as Record<string, unknown>)[evt.name];
      if (src instanceof EventSource)
        src.sink = (v: unknown) => this.emitEventByIndex(evt.index, v);
    }

    resource.addDestroyHandler((sender) => {
      this.isDestroyed = true;
      this.destroyed.emit(sender as IResource);
    });
  }

  get store(): IStore {
    return this.store_;
  }

  /** The managed resource, or `undefined` if it has been collected. */
  get resource(): IResource | undefined {
    return this.resourceRef.deref();
  }

  /** Instance age, incremented on each property modification. */
  get age(): number {
    return this.instanceAge;
  }

  getAge(index: number): number | undefined {
    return index < this.ages.length ? this.ages[index] : 0;
  }

  setAge(index: number, value: number): void {
    if (index < this.ages.length) {
      this.ages[index] = value;
      if (value > this.instanceAge) this.instanceAge = value;
    }
  }

  getModificationDate(index: number): Date | undefined {
    return index < this.modificationDates.length ? this.modificationDates[index] : undefined;
  }

  /** Notify that an exported property changed (called by the generated setter). */
  modified(name: string, value?: unknown): void {
    if (this.loading) return;
    const pt = this.definition.getPropertyByName(name);
    const res = this.resource;
    if (!pt || !res) return;
    const v =
      arguments.length > 1 ? value : (res as unknown as Record<string, unknown>)[name];
    this.emitModification(pt, v);
  }

  private emitModification(property: PropertyTemplate, value: unknown): void {
    const res = this.resource;
    if (!res) return;
    this.instanceAge++;
    const now = new Date();
    this.ages[property.index] = this.instanceAge;
    this.modificationDates[property.index] = now;
    this.store_.modify(res, property, value, this.instanceAge, now);
    this.propertyModified.emit({ resource: res, property, value, age: this.instanceAge });
  }

  /** Raise an exported event by its TypeDef index. */
  emitEventByIndex(index: number, value: unknown): void {
    const res = this.resource;
    if (!res) return;
    const def = this.definition.getEventByIndex(index);
    if (!def) return;
    this.eventOccurred.emit({ resource: res, event: def, value });
  }

  /** The permanent path link to the resource. */
  get link(): string | undefined {
    const res = this.resource;
    if (!res) return undefined;
    if ((res as IResource) === (this.store_ as IResource)) return this.name; // root store
    return `${this.store_.instance?.name}/${this.store_.link(res)}`;
  }
}
