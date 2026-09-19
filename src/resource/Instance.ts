import { EventHandler } from "../core/EventHandler.js";
import type { IResource, IStore } from "./IResource.js";
import type { Warehouse } from "./Warehouse.js";
import type { TypeDef, PropertyTemplate, EventTemplate } from "./template.js";
import { EventSource } from "./decorators.js";
import { isDynamicResource } from "./IDynamicResource.js";
import { ResourceCursor } from "./ResourceCursor.js";
import {
  ResourceJournalEntryKind,
  isResourceJournalStore,
  type ResourceJournalEntry,
  type ResourceJournalPage,
  type ResourceJournalQuery,
} from "./ResourceJournal.js";
import type { Uuid } from "../data/Uuid.js";

/** Payload for {@link Instance.propertyModified}. */
export interface PropertyModificationInfo {
  resource: IResource;
  property: PropertyTemplate;
  value: unknown;
  age: number;
  cursor: ResourceCursor;
  recordedAt: Date;
}

/** Payload for {@link Instance.eventOccurred}. */
export interface EventOccurredInfo {
  resource: IResource;
  event: EventTemplate;
  value: unknown;
  cursor: ResourceCursor;
  recordedAt: Date;
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
  private streamCursor: ResourceCursor;
  private loading = false;

  constructor(
    warehouse: Warehouse,
    id: number,
    name: string,
    resource: IResource,
    store: IStore,
    age = 0,
    resourceKey = name,
  ) {
    this.warehouse = warehouse;
    this.id = id;
    this.name = name ?? "";
    this.store_ = store;
    this.resourceRef = new WeakRef(resource);
    const dynamicCursor = (resource as IResource & { cursor?: ResourceCursor }).cursor;
    const proposedCursor = dynamicCursor ?? ResourceCursor.create(BigInt(age));
    this.streamCursor = isResourceJournalStore(store)
      ? store.openJournal(resource, resourceKey, proposedCursor)
      : proposedCursor;

    // A dynamic resource (e.g. a remote EpResource proxy relayed into this
    // warehouse) carries its own TypeDef and current property state directly
    // — there's no real constructor-per-remote-type to look TypeDef up from,
    // and unlike a freshly-`new`ed local resource it may already have live
    // data (fetched before being `put()`), so ages/dates must be seeded from
    // it rather than starting at zero.
    const dyn = isDynamicResource(resource) ? resource : undefined;
    this.definition = dyn ? dyn.resourceDefinition : warehouse.getTypeDef(resource.constructor);

    for (let i = 0; i < this.definition.properties.length; i++) {
      this.ages.push(dyn ? dyn.getResourcePropertyAge(i) : 0);
      this.modificationDates.push(dyn ? dyn.getResourcePropertyDate(i) : undefined);
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
    return Number(this.streamCursor.revision);
  }

  get generation(): Uuid {
    return this.streamCursor.generation;
  }

  get cursor(): ResourceCursor {
    return this.streamCursor;
  }

  getAge(index: number): number | undefined {
    return index < this.ages.length ? this.ages[index] : 0;
  }

  setAge(index: number, value: number): void {
    if (index < this.ages.length) {
      this.ages[index] = value;
      if (BigInt(value) > this.streamCursor.revision)
        this.streamCursor = new ResourceCursor(this.streamCursor.generation, BigInt(value));
    }
  }

  getModificationDate(index: number): Date | undefined {
    return index < this.modificationDates.length ? this.modificationDates[index] : undefined;
  }

  setModificationDate(index: number, date: Date | undefined): void {
    if (index < this.modificationDates.length) this.modificationDates[index] = date;
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
    const cursor = this.nextCursor();
    const now = new Date();
    const age = Number(cursor.revision);
    this.ages[property.index] = age;
    this.modificationDates[property.index] = now;
    this.store_.modify(res, property, value, age, now);
    this.commitJournal(
      res,
      {
        cursor,
        recordedAt: now,
        kind: ResourceJournalEntryKind.PropertyModified,
        memberIndex: property.index,
        value,
      },
      property.historical,
    );
    this.propertyModified.emit({ resource: res, property, value, age, cursor, recordedAt: now });
  }

  /** Raise an exported event by its TypeDef index. */
  emitEventByIndex(index: number, value: unknown): void {
    const res = this.resource;
    if (!res) return;
    const def = this.definition.getEventByIndex(index);
    if (!def) return;
    const cursor = this.nextCursor();
    const recordedAt = new Date();
    this.commitJournal(
      res,
      {
        cursor,
        recordedAt,
        kind: ResourceJournalEntryKind.EventOccurred,
        memberIndex: def.index,
        value,
      },
      def.historical,
    );
    this.eventOccurred.emit({ resource: res, event: def, value, cursor, recordedAt });
  }

  queryJournal(query: ResourceJournalQuery = {}): ResourceJournalPage {
    const res = this.resource;
    if (res && isResourceJournalStore(this.store_))
      return this.store_.queryJournal(res, query);
    return {
      oldestAvailable: this.cursor,
      highWatermark: this.cursor,
      next: query.after ?? this.cursor,
      cursorExpired: false,
      hasMore: false,
      entries: [],
    };
  }

  applyRemotePropertyModification(
    property: PropertyTemplate,
    value: unknown,
    cursor: ResourceCursor,
    recordedAt: Date,
  ): void {
    const res = this.resource;
    if (!res) return;
    this.observeRemoteCursor(cursor);
    const age = Number(cursor.revision);
    this.ages[property.index] = age;
    this.modificationDates[property.index] = recordedAt;
    this.store_.modify(res, property, value, age, recordedAt);
    this.commitJournal(
      res,
      {
        cursor,
        recordedAt,
        kind: ResourceJournalEntryKind.PropertyModified,
        memberIndex: property.index,
        value,
      },
      property.historical,
    );
    this.propertyModified.emit({ resource: res, property, value, age, cursor, recordedAt });
  }

  applyRemoteEvent(
    event: EventTemplate,
    value: unknown,
    cursor: ResourceCursor,
    recordedAt: Date,
  ): void {
    const res = this.resource;
    if (!res) return;
    this.observeRemoteCursor(cursor);
    this.commitJournal(
      res,
      {
        cursor,
        recordedAt,
        kind: ResourceJournalEntryKind.EventOccurred,
        memberIndex: event.index,
        value,
      },
      event.historical,
    );
    this.eventOccurred.emit({ resource: res, event, value, cursor, recordedAt });
  }

  private nextCursor(): ResourceCursor {
    this.streamCursor = new ResourceCursor(
      this.streamCursor.generation,
      this.streamCursor.revision + 1n,
    );
    return this.streamCursor;
  }

  private observeRemoteCursor(cursor: ResourceCursor): void {
    const res = this.resource;
    if (!this.streamCursor.generation.equals(cursor.generation)) {
      if (res && isResourceJournalStore(this.store_)) {
        this.store_.removeJournal(res);
        this.store_.openJournal(
          res,
          this.link ?? this.name,
          new ResourceCursor(cursor.generation, 0n),
        );
        this.streamCursor = cursor;
      } else this.streamCursor = cursor;
    } else if (cursor.revision > this.streamCursor.revision) this.streamCursor = cursor;
  }

  private commitJournal(
    resource: IResource,
    entry: ResourceJournalEntry,
    retain: boolean,
  ): void {
    if (
      isResourceJournalStore(this.store_) &&
      !this.store_.appendJournalEntry(resource, entry, retain)
    )
      throw new Error(`The store rejected resource journal revision ${entry.cursor}.`);
  }

  /** The permanent path link to the resource. */
  get link(): string | undefined {
    const res = this.resource;
    if (!res) return undefined;
    if ((res as IResource) === (this.store_ as IResource)) return this.name; // root store
    return `${this.store_.instance?.name}/${this.store_.link(res)}`;
  }
}
