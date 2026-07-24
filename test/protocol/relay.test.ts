import { describe, it, expect, vi } from "vitest";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export, event, type EventSource } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";
import { Ruling } from "../../src/security/permissions/Ruling.js";
import type { IPermissionsManager } from "../../src/security/permissions/IPermissionsManager.js";

class RelayCounter extends Resource {
  @Export(t.i32) accessor counts = 0;
  @Export(t.string) ping: EventSource<string> = event<string>();

  @Export(t.i32, [t.i32])
  bump(by: number): number {
    this.counts += by;
    return this.counts;
  }
}

/** Allows every action — SetProperty (and other mutating actions) fail closed by default without one. */
class AllowManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  readonly settings = undefined;
  applicable = vi.fn((): Ruling => Ruling.Allowed);
  initialize(): boolean {
    return true;
  }
}

interface RelayProxy {
  counts: number;
  instanceId: number;
  bump(by: number): Promise<number>;
  on(name: string, cb: (value: unknown) => void): void;
  off(name: string, cb: (value: unknown) => void): void;
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("EpResource as IResource — relay through a third node", () => {
  it("lets a resource fetched by node B be put() into B's warehouse and attached to by node C", async () => {
    // Node A: hosts the real resource.
    const whA = new Warehouse();
    whA.registerManager(new AllowManager(), true);
    await whA.put("sys", new MemoryStore());
    const counter = await whA.put("sys/counter", new RelayCounter());
    await whA.open();
    const serverA = await EpServer.listen({ port: 0, warehouse: whA });

    // Node B: fetches the resource from A, then relays it under its own warehouse.
    const whB = new Warehouse();
    whB.registerManager(new AllowManager(), true);
    await whB.put("sys", new MemoryStore());
    await whB.open();
    const connectionToA = await EpConnection.connect(`ws://127.0.0.1:${serverA.port}`);
    connectionToA.warehouse = whB;

    // No TypeDef supplied — drives the real TypeDefByResourceId round trip.
    const viaB = (await connectionToA.get("sys/counter")) as unknown as RelayProxy;
    const rawFromA = connectionToA.getAttachedResource(viaB.instanceId)!;
    expect(rawFromA.instance).toBeUndefined(); // not yet relayed

    await whB.put("sys/relay", rawFromA);
    expect(rawFromA.instance).toBeDefined(); // now a first-class warehouse member

    const serverB = await EpServer.listen({ port: 0, warehouse: whB });

    // Node C: connects only to B, never to A directly. Also no TypeDef
    // supplied here — this is the harder case for TypeDefByResourceId,
    // since the resource behind "sys/relay" is a *relayed* EpResource with
    // no LocalTypeDef of its own on B (exercises the typeDefId-forwarding
    // path in epRequestTypeDefByResourceId).
    const connectionToB = await EpConnection.connect(`ws://127.0.0.1:${serverB.port}`);
    const viaC = (await connectionToB.get("sys/relay")) as unknown as RelayProxy;

    // Initial read relays through B to A's real state.
    expect(viaC.counts).toBe(0);

    // Write from C relays through B and lands on A's real resource.
    viaC.counts = 7;
    await waitFor(() => counter.counts === 7);

    // Function call from C relays through B to A and returns A's real result.
    const result = await viaC.bump(3);
    expect(result).toBe(10);
    expect(counter.counts).toBe(10);

    // A live change made directly on A (not through the relay) propagates
    // through B's Instance and out to C.
    counter.counts = 99;
    await waitFor(() => viaC.counts === 99);

    // Subscribable event: C subscribes, which must ref-count B's own
    // upstream subscription to A so the occurrence actually reaches B first.
    const received: string[] = [];
    viaC.on("ping", (v) => received.push(v as string));
    await new Promise((r) => setTimeout(r, 100)); // let the Subscribe round-trips (C->B, B->A) land

    counter.ping.emit("hello");
    await waitFor(() => received.length === 1);
    expect(received).toEqual(["hello"]);

    connectionToB.close();
    connectionToA.close();
    await serverB.close();
    await serverA.close();
  });
});
