import type { IResource } from "./IResource.js";
import { ResourceCursor } from "./ResourceCursor.js";

export enum ResourceJournalEntryKind {
  PropertyModified = 0,
  EventOccurred = 1,
}

export interface ResourceJournalEntry {
  cursor: ResourceCursor;
  recordedAt: Date;
  kind: ResourceJournalEntryKind;
  memberIndex: number;
  value: unknown;
}

export interface ResourceJournalQuery {
  after?: ResourceCursor;
  throughRevision?: bigint;
  fromTime?: Date;
  toTime?: Date;
  kind?: ResourceJournalEntryKind;
  memberIndex?: number;
  limit?: number;
}

export interface ResourceJournalPage {
  oldestAvailable: ResourceCursor;
  highWatermark: ResourceCursor;
  next: ResourceCursor;
  cursorExpired: boolean;
  hasMore: boolean;
  entries: ResourceJournalEntry[];
}

/** Optional store capability for retaining resource changes. */
export interface IResourceJournalStore {
  openJournal(
    resource: IResource,
    resourceKey: string,
    proposedCursor: ResourceCursor,
  ): ResourceCursor;
  appendJournalEntry(resource: IResource, entry: ResourceJournalEntry, retain: boolean): boolean;
  queryJournal(resource: IResource, query?: ResourceJournalQuery): ResourceJournalPage;
  removeJournal(resource: IResource): void;
}

export function isResourceJournalStore(value: unknown): value is IResourceJournalStore {
  const candidate = value as Partial<IResourceJournalStore> | null;
  return (
    candidate != null &&
    typeof candidate.openJournal === "function" &&
    typeof candidate.appendJournalEntry === "function" &&
    typeof candidate.queryJournal === "function" &&
    typeof candidate.removeJournal === "function"
  );
}

interface JournalState {
  head: ResourceCursor;
  discardedThroughRevision: bigint;
  entries: ResourceJournalEntry[];
}

/** Bounded process-local journal used by volatile stores and tests. */
export class ResourceJournalBuffer implements IResourceJournalStore {
  private readonly states = new Map<IResource, JournalState>();

  constructor(readonly maximumEntriesPerResource = 10_000) {
    if (!Number.isInteger(maximumEntriesPerResource) || maximumEntriesPerResource < 1)
      throw new RangeError("maximumEntriesPerResource must be a positive integer.");
  }

  openJournal(
    resource: IResource,
    _resourceKey: string,
    proposedCursor: ResourceCursor,
  ): ResourceCursor {
    const existing = this.states.get(resource);
    if (existing) return existing.head;
    const head = proposedCursor.generation.data.every((value) => value === 0)
      ? ResourceCursor.create(proposedCursor.revision)
      : proposedCursor;
    this.states.set(resource, {
      head,
      discardedThroughRevision: 0n,
      entries: [],
    });
    return head;
  }

  appendJournalEntry(resource: IResource, entry: ResourceJournalEntry, retain: boolean): boolean {
    let state = this.states.get(resource);
    if (!state) {
      state = {
        head: new ResourceCursor(entry.cursor.generation, 0n),
        discardedThroughRevision: 0n,
        entries: [],
      };
      this.states.set(resource, state);
    }
    if (
      !state.head.generation.equals(entry.cursor.generation) ||
      entry.cursor.revision <= state.head.revision
    )
      return false;

    state.head = entry.cursor;
    if (retain) state.entries.push(entry);
    while (state.entries.length > this.maximumEntriesPerResource) {
      const discarded = state.entries.shift()!;
      if (discarded.cursor.revision > state.discardedThroughRevision)
        state.discardedThroughRevision = discarded.cursor.revision;
    }
    return true;
  }

  queryJournal(resource: IResource, query: ResourceJournalQuery = {}): ResourceJournalPage {
    let state = this.states.get(resource);
    if (!state) {
      const head = ResourceCursor.create();
      state = { head, discardedThroughRevision: 0n, entries: [] };
      this.states.set(resource, state);
    }

    const requestedAfter = query.after ?? ResourceCursor.empty();
    const generationMismatch =
      !requestedAfter.isEmpty && !requestedAfter.generation.equals(state.head.generation);
    const after = generationMismatch
      ? new ResourceCursor(state.head.generation, 0n)
      : requestedAfter;
    const cursorExpired =
      generationMismatch || after.revision < state.discardedThroughRevision;
    const limit = Math.max(1, Math.min(query.limit ?? 1_000, 10_000));
    const filtered = state.entries.filter((entry) => {
      if (entry.cursor.revision <= after.revision) return false;
      if (query.throughRevision != null && entry.cursor.revision > query.throughRevision)
        return false;
      if (query.fromTime && entry.recordedAt < query.fromTime) return false;
      if (query.toTime && entry.recordedAt > query.toTime) return false;
      if (query.kind != null && entry.kind !== query.kind) return false;
      if (query.memberIndex != null && entry.memberIndex !== query.memberIndex) return false;
      return true;
    });
    const hasMore = filtered.length > limit;
    const entries = filtered.slice(0, limit);
    const next = entries.at(-1)?.cursor ?? after;
    return {
      oldestAvailable: state.entries[0]?.cursor ?? state.head,
      highWatermark: state.head,
      next,
      cursorExpired,
      hasMore,
      entries,
    };
  }

  removeJournal(resource: IResource): void {
    this.states.delete(resource);
  }
}
