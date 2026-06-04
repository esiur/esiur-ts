import { describe, it, expect } from "vitest";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export, event, type EventSource } from "../../src/resource/decorators.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { t } from "../../src/data/descriptors.js";

class HelloResource extends Resource {
  @Export(t.i32) accessor counts = 0;
  @Export(t.string) greetingReceived: EventSource<string> = event<string>();

  @Export(t.string, [t.string])
  sayHi(msg: string): string {
    this.counts++;
    this.greetingReceived.emit(msg);
    return `Welcome, ${msg}`;
  }
}

describe("resource template from decorators", () => {
  it("describes properties, functions and events", () => {
    const tmpl = new Warehouse().getTemplate(HelloResource);
    expect(tmpl.properties.map((p) => p.name)).toEqual(["counts"]);
    expect(tmpl.functions.map((f) => f.name)).toEqual(["sayHi"]);
    expect(tmpl.events.map((e) => e.name)).toEqual(["greetingReceived"]);
    expect(tmpl.getPropertyByName("counts")?.valueType).toBeDefined();
    expect(tmpl.getFunctionByName("sayHi")?.args.length).toBe(1);
  });
});

describe("warehouse put/get and notifications", () => {
  it("puts/gets resources, notifies property changes, invokes functions, raises events", async () => {
    const wh = new Warehouse();
    const store = await wh.put("sys", new MemoryStore());
    const hello = await wh.put("sys/hello", new HelloResource());
    await wh.open();

    expect(await wh.get("sys/hello")).toBe(hello);
    expect(wh.getById(hello.instance!.id)).toBe(hello);

    const mods: number[] = [];
    hello.instance!.propertyModified.add((info) => mods.push(info.value as number));

    const localGreetings: string[] = [];
    hello.greetingReceived.listen((g) => localGreetings.push(g));
    const networkEvents: string[] = [];
    hello.instance!.eventOccurred.add((info) => networkEvents.push(info.value as string));

    const reply = hello.sayHi("Ahmed");
    expect(reply).toBe("Welcome, Ahmed");
    expect(hello.counts).toBe(1);
    expect(mods).toEqual([1]);
    expect(localGreetings).toEqual(["Ahmed"]);
    expect(networkEvents).toEqual(["Ahmed"]);

    expect(store.instance!.link).toBe("sys");
    expect(hello.instance!.link).toBe("sys/hello");
    expect(hello.instance!.age).toBe(1);
  });

  it("rejects a non-store resource at the root path", async () => {
    const wh = new Warehouse();
    await expect(wh.put("hello", new HelloResource()) as PromiseLike<unknown>).rejects.toThrow(
      /not a store/,
    );
  });
});
