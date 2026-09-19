import { describe, expect, it } from "vitest";
import { t } from "../../src/data/descriptors.js";
import { Resource } from "../../src/resource/Resource.js";
import {
  Export,
  Historical,
  event,
  type EventSource,
} from "../../src/resource/decorators.js";
import {
  ResourceJournalBuffer,
  ResourceJournalEntryKind,
} from "../../src/resource/ResourceJournal.js";
import { ResourceCursor } from "../../src/resource/ResourceCursor.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";

class JournalResource extends Resource {
  @Export(t.i32) @Historical() accessor value = 0;
  @Export(t.string) @Historical() changed: EventSource<string> = event<string>();
  @Export(t.string) transient: EventSource<string> = event<string>();
}

describe("resource journal", () => {
  it("orders retained properties and events in one revision stream", async () => {
    const warehouse = new Warehouse();
    await warehouse.put("sys", new MemoryStore());
    const resource = await warehouse.put("sys/journal", new JournalResource());
    await warehouse.open();

    resource.value = 7;
    resource.changed.emit("retained");
    resource.transient.emit("live-only");

    const page = resource.instance!.queryJournal();
    expect(page.entries.map((entry) => [
      entry.cursor.revision,
      entry.kind,
      entry.value,
    ])).toEqual([
      [1n, ResourceJournalEntryKind.PropertyModified, 7],
      [2n, ResourceJournalEntryKind.EventOccurred, "retained"],
    ]);
    expect(page.highWatermark.revision).toBe(3n);
    expect(page.entries.every((entry) =>
      entry.cursor.generation.equals(page.highWatermark.generation))).toBe(true);
  });

  it("reports an expired cursor after bounded retention discards entries", async () => {
    const warehouse = new Warehouse();
    await warehouse.put("sys", new MemoryStore(new ResourceJournalBuffer(2)));
    const resource = await warehouse.put("sys/journal", new JournalResource());
    await warehouse.open();

    resource.value = 1;
    resource.value = 2;
    resource.value = 3;

    const page = resource.instance!.queryJournal({
      after: new ResourceCursor(resource.instance!.generation, 0n),
    });
    expect(page.cursorExpired).toBe(true);
    expect(page.oldestAvailable.revision).toBe(2n);
    expect(page.entries.map((entry) => entry.value)).toEqual([2, 3]);
  });
});
