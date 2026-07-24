import { describe, it, expect, vi } from "vitest";
import {
  readProperty,
  snapshotProperties,
  subscribeToProperty,
  subscribeToResource,
  subscribeToResourceEvent,
} from "../../src/resource/reactive.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export, event, type EventSource } from "../../src/resource/decorators.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { t } from "../../src/data/descriptors.js";
import { EpResource } from "../../src/protocol/EpResource.js";
import { TypeDef, PropertyTemplate } from "../../src/resource/template.js";
import type { EpConnection } from "../../src/protocol/EpConnection.js";

class Widget extends Resource {
  @Export(t.i32) accessor level = 1;
  @Export(t.string) accessor status = "idle";
  @Export(t.string) message: EventSource<string> = event<string>();
}

async function makeLocalWidget(): Promise<Widget> {
  const wh = new Warehouse();
  await wh.put("sys", new MemoryStore());
  const widget = await wh.put("sys/widget", new Widget());
  await wh.open();
  return widget;
}

function makeRemoteWidget(): EpResource & Record<string, unknown> {
  const typeDef = new TypeDef("Widget", [
    new PropertyTemplate("level", 0, t.i32),
    new PropertyTemplate("status", 1, t.string),
  ]);
  const raw = new EpResource({} as EpConnection, 1, typeDef);
  raw.setPropertySnapshot(0, 1, undefined, 1);
  raw.setPropertySnapshot(1, 1, undefined, "idle");
  return EpResource.createProxy(raw);
}

describe("reactive.ts — local resources (Instance.propertyModified)", () => {
  it("readProperty reads the live @Export accessor value", async () => {
    const widget = await makeLocalWidget();
    expect(readProperty(widget, "level")).toBe(1);
    widget.level = 7;
    expect(readProperty(widget, "level")).toBe(7);
  });

  it("subscribeToProperty fires only for the named property, with the new value", async () => {
    const widget = await makeLocalWidget();
    const onLevel = vi.fn();
    const unsubscribe = subscribeToProperty(widget, "level", onLevel);

    widget.status = "busy"; // different property — should not fire onLevel
    widget.level = 42;

    expect(onLevel).toHaveBeenCalledTimes(1);
    expect(onLevel).toHaveBeenCalledWith(42);

    unsubscribe();
    widget.level = 99;
    expect(onLevel).toHaveBeenCalledTimes(1); // no further calls after unsubscribe
  });

  it("subscribeToResource fires for any property change", async () => {
    const widget = await makeLocalWidget();
    const changes: Array<{ name: string; value: unknown }> = [];
    subscribeToResource(widget, (e) => changes.push(e));

    widget.level = 2;
    widget.status = "busy";

    expect(changes).toEqual([
      { name: "level", value: 2 },
      { name: "status", value: "busy" },
    ]);
  });

  it("snapshotProperties reads every exported property into a plain object", async () => {
    const widget = await makeLocalWidget();
    widget.level = 5;
    widget.status = "busy";
    expect(snapshotProperties(widget)).toEqual({ level: 5, status: "busy" });
  });

  it("subscribeToResourceEvent fires for a local EventSource field", async () => {
    const widget = await makeLocalWidget();
    const onMessage = vi.fn();
    subscribeToResourceEvent(widget, "message", onMessage);
    widget.message.emit("hello");
    expect(onMessage).toHaveBeenCalledWith("hello");
  });
});

describe("reactive.ts — remote resources (EpResource proxy)", () => {
  it("readProperty reads the proxy's cached value", () => {
    const remote = makeRemoteWidget();
    expect(readProperty(remote, "level")).toBe(1);
  });

  it("subscribeToProperty fires when a PropertyModified notification is applied", () => {
    const remote = makeRemoteWidget();
    const onLevel = vi.fn();
    subscribeToProperty(remote, "level", onLevel);

    // Simulates what EpConnection.processNotification does on PropertyModified.
    (remote as unknown as EpResource).updateProperty(0, 9);

    expect(onLevel).toHaveBeenCalledWith(9);
    expect(readProperty(remote, "level")).toBe(9);
  });

  it("snapshotProperties reads the proxy's TypeDef-declared properties", () => {
    const remote = makeRemoteWidget();
    expect(snapshotProperties(remote)).toEqual({ level: 1, status: "idle" });
  });

  it("subscribeToResourceEvent filters the single eventOccurred notifier by name", () => {
    const raw = new EpResource({} as EpConnection, 1, new TypeDef("Widget", []));
    const remote = EpResource.createProxy(raw);
    const onMessage = vi.fn();
    subscribeToResourceEvent(remote, "message", onMessage);

    // No "message" event on this bare TypeDef, so applyEvent finds nothing —
    // confirms the subscription doesn't throw when the event isn't declared.
    (remote as unknown as EpResource).applyEvent(0, "hi");
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("unsubscribing stops further notifications", () => {
    const remote = makeRemoteWidget();
    const onChange = vi.fn();
    const unsubscribe = subscribeToResource(remote, onChange);
    (remote as unknown as EpResource).updateProperty(0, 2);
    unsubscribe();
    (remote as unknown as EpResource).updateProperty(0, 3);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("reactive.ts — resources with no recognizable notifier", () => {
  it("subscribeToResource on a plain object returns a no-op unsubscribe instead of throwing", () => {
    const unsubscribe = subscribeToResource({ foo: 1 }, () => {});
    expect(() => unsubscribe()).not.toThrow();
  });

  it("readProperty/snapshotProperties handle null/undefined resources gracefully", () => {
    expect(readProperty(undefined, "x")).toBeUndefined();
    expect(readProperty(null, "x")).toBeUndefined();
    expect(snapshotProperties(undefined)).toEqual({});
  });
});
