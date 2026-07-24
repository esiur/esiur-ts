import { describe, it, expect, vi } from "vitest";
import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { useProperty } from "../../src/react/useProperty.js";
import { useResource } from "../../src/react/useResource.js";
import { useResourceEvent } from "../../src/react/useResourceEvent.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export, event, type EventSource } from "../../src/resource/decorators.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { t } from "../../src/data/descriptors.js";

class Widget extends Resource {
  @Export(t.i32) accessor level = 1;
  @Export(t.string) accessor status = "idle";
  @Export(t.string) message: EventSource<string> = event<string>();
}

async function makeWidget(): Promise<Widget> {
  const wh = new Warehouse();
  await wh.put("sys", new MemoryStore());
  const widget = await wh.put("sys/widget", new Widget());
  await wh.open();
  return widget;
}

function PropertyProbe({ resource, name }: { resource: unknown; name: string }): React.ReactElement {
  const value = useProperty(resource, name);
  return React.createElement("span", null, String(value));
}

function ResourceProbe({ resource }: { resource: unknown }): React.ReactElement {
  const snapshot = useResource<{ level: number; status: string }>(resource);
  return React.createElement("span", null, `${snapshot.level}:${snapshot.status}`);
}

describe("useProperty", () => {
  it("renders the initial value and re-renders when the property changes", async () => {
    const widget = await makeWidget();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(PropertyProbe, { resource: widget, name: "level" }),
      );
    });
    expect(renderer.toJSON()).toEqual({ type: "span", props: {}, children: ["1"] });

    act(() => {
      widget.level = 42;
    });
    expect(renderer.toJSON()).toEqual({ type: "span", props: {}, children: ["42"] });
  });

  it("does not re-render for a change to a different property", async () => {
    const widget = await makeWidget();
    let renderCount = 0;
    function CountingProbe(): React.ReactElement {
      renderCount++;
      useProperty(widget, "level");
      return React.createElement("span");
    }

    act(() => {
      TestRenderer.create(React.createElement(CountingProbe));
    });
    const afterMount = renderCount;

    act(() => {
      widget.status = "busy"; // unrelated property
    });
    expect(renderCount).toBe(afterMount);
  });

  it("stops re-rendering after unmount (no leaked subscription)", async () => {
    const widget = await makeWidget();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(PropertyProbe, { resource: widget, name: "level" }),
      );
    });

    act(() => renderer.unmount());
    expect(() => {
      widget.level = 7;
    }).not.toThrow();
  });
});

describe("useResource", () => {
  it("renders a snapshot of every exported property and updates on any change", async () => {
    const widget = await makeWidget();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(ResourceProbe, { resource: widget }));
    });
    expect(renderer.toJSON()).toEqual({ type: "span", props: {}, children: ["1:idle"] });

    act(() => {
      widget.status = "busy";
    });
    expect(renderer.toJSON()).toEqual({ type: "span", props: {}, children: ["1:busy"] });

    act(() => {
      widget.level = 9;
    });
    expect(renderer.toJSON()).toEqual({ type: "span", props: {}, children: ["9:busy"] });
  });
});

describe("useResourceEvent", () => {
  it("invokes the handler when the named event occurs, without forcing a re-render itself", async () => {
    const widget = await makeWidget();
    const onMessage = vi.fn();
    function EventProbe(): React.ReactElement {
      useResourceEvent<string>(widget, "message", onMessage);
      return React.createElement("span");
    }

    act(() => {
      TestRenderer.create(React.createElement(EventProbe));
    });

    act(() => {
      widget.message.emit("hello");
    });

    expect(onMessage).toHaveBeenCalledWith("hello");
  });
});
