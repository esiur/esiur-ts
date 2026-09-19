import { describe, it, expect, vi } from "vitest";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { WSocket } from "../../src/net/sockets/WSocket.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import {
  Export,
  AutoDelivered,
  Historical,
  event,
  type EventSource,
} from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";
import type { ResourceCursor } from "../../src/resource/ResourceCursor.js";
import type {
  ResourceJournalPage,
  ResourceJournalQuery,
} from "../../src/resource/ResourceJournal.js";

class Beacon extends Resource {
  @Export(t.i32) @Historical() accessor pings = 0;

  // Default: subscribable, requires an explicit Subscribe before occurrences flow.
  @Export(t.string) @Historical() ping: EventSource<string> = event<string>();

  // Opts out via @AutoDelivered(): flows to every attached connection unconditionally.
  @Export(t.string) @AutoDelivered() tick: EventSource<string> = event<string>();

  fire(name: "ping" | "tick", value: string): void {
    this.pings++;
    this[name].emit(value);
  }
}

interface ListenableProxy {
  on(name: string, cb: (value: unknown) => void): void;
  off(name: string, cb: (value: unknown) => void): void;
  eventOccurred: { add(cb: (value: unknown) => void): void };
  cursor: ResourceCursor;
  onFromAsync(
    name: string,
    after: ResourceCursor,
    cb: (value: unknown) => void,
  ): PromiseLike<ListenableProxy>;
  queryJournal(query?: ResourceJournalQuery): PromiseLike<ResourceJournalPage>;
}

async function makeServerAndClient(): Promise<{
  warehouse: Warehouse;
  beacon: Beacon;
  beaconId: number;
  server: WebSocketServer;
  client: EpConnection;
  res: ListenableProxy;
}> {
  const warehouse = new Warehouse();
  await warehouse.put("sys", new MemoryStore());
  const beacon = await warehouse.put("sys/beacon", new Beacon());
  await warehouse.open();
  const beaconId = beacon.instance!.id;
  const typeDef = warehouse.getTypeDef(Beacon);

  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => server.on("listening", () => r()));
  const port = (server.address() as { port: number }).port;
  server.on("connection", (raw: WsWebSocket) => {
    const sc = new EpConnection();
    sc.warehouse = warehouse;
    sc.assign(new WSocket(raw as unknown as WebSocket));
  });

  const client = new EpConnection();
  const sock = new WSocket();
  client.assign(sock);
  await sock.connect(`ws://127.0.0.1:${port}`);

  const res = (await client.attach(beaconId, typeDef)) as unknown as ListenableProxy;

  return { warehouse, beacon, beaconId, server, client, res };
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
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

describe("EpResource.on/.off — event subscription", () => {
  it("delivers an auto-delivered event with no Subscribe call needed", async () => {
    const { beacon, server, client, res } = await makeServerAndClient();
    const received: string[] = [];
    res.on("tick", (v) => received.push(String(v)));

    beacon.fire("tick", "a");
    await waitFor(() => received.length === 1);
    expect(received).toEqual(["a"]);

    client.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("gates a subscribable event server-side until Subscribe is sent", async () => {
    const { beacon, beaconId, server, client, res } = await makeServerAndClient();

    // Bypass the ref-counted `.on()` wrapper to test server-side gating directly:
    // fire the event with no subscription in effect — nothing should arrive.
    const early: unknown[] = [];
    res.eventOccurred.add((c) => early.push(c));
    beacon.fire("ping", "too-early");
    await new Promise((r) => setTimeout(r, 100));
    expect(early).toEqual([]);

    // Now explicitly subscribe (low-level API) and confirm it starts flowing.
    await client.subscribe(beaconId, 0);
    beacon.fire("ping", "now");
    await waitFor(() => early.length === 1);
    expect(early[0]).toMatchObject({ name: "ping", value: "now" });

    client.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it(".on() ref-counts listeners: a 2nd listener doesn't re-subscribe, .off() only unsubscribes at zero", async () => {
    const { beacon, server, client, res } = await makeServerAndClient();
    const subscribeSpy = vi.spyOn(client, "subscribe");
    const unsubscribeSpy = vi.spyOn(client, "unsubscribe");

    const a: string[] = [];
    const b: string[] = [];
    const cbA = (v: unknown): void => void a.push(String(v));
    const cbB = (v: unknown): void => void b.push(String(v));

    res.on("ping", cbA);
    await waitFor(() => subscribeSpy.mock.calls.length === 1);

    res.on("ping", cbB); // 2nd listener — must not send a 2nd Subscribe
    await new Promise((r) => setTimeout(r, 50));
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    beacon.fire("ping", "x");
    await waitFor(() => a.length === 1 && b.length === 1);

    res.off("ping", cbA); // one listener remains — must not unsubscribe yet
    await new Promise((r) => setTimeout(r, 50));
    expect(unsubscribeSpy).not.toHaveBeenCalled();

    beacon.fire("ping", "y");
    await waitFor(() => b.length === 2);
    expect(a).toEqual(["x"]); // cbA got nothing after being removed

    res.off("ping", cbB); // last listener — now it should unsubscribe
    await waitFor(() => unsubscribeSpy.mock.calls.length === 1);

    client.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it(":propertyName listens for property changes with no wire subscription", async () => {
    const { beacon, server, client, res } = await makeServerAndClient();
    const seen: unknown[] = [];
    res.on(":pings", (v) => seen.push(v));

    beacon.fire("tick", "z");
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([1]);

    client.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("reports completed notifications as no longer pending", async () => {
    const { beacon, server, client, res } = await makeServerAndClient();
    const properties: unknown[] = [];
    const events: string[] = [];
    res.on(":pings", (value) => properties.push(value));
    res.on("tick", (value) => events.push(String(value)));
    client.enableRuntimeMetrics();

    beacon.fire("tick", "done");
    await waitFor(() => properties.length === 1 && events.length === 1);

    const metrics = client.getRuntimeMetrics();
    expect(metrics.receivedNotifications).toBeGreaterThanOrEqual(2);
    expect(metrics.queuedNotificationWork).toBe(0);

    client.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("yields to the host event loop while preserving a large property-notification burst", async () => {
    const { beacon, server, client, res } = await makeServerAndClient();
    let received = 0;
    let receivedWhenTimerRan = Number.POSITIVE_INFINITY;
    res.on(":pings", () => {
      received++;
      if (received === 1) {
        setTimeout(() => {
          receivedWhenTimerRan = received;
        }, 0);
      }
    });

    for (let index = 1; index <= 512; index++) beacon.pings = index;

    await waitFor(() => received === 512);
    await waitFor(() => Number.isFinite(receivedWhenTimerRan));
    expect(receivedWhenTimerRan).toBeLessThan(512);
    expect(res.cursor.revision).toBeGreaterThanOrEqual(512n);

    client.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("queries the unified journal and replays a historical event from a cursor", async () => {
    const { beacon, server, client, res } = await makeServerAndClient();
    const attachedAt = res.cursor;

    beacon.fire("ping", "missed");

    const page = await res.queryJournal({ after: attachedAt });
    expect(page.entries.map((entry) => [entry.kind, entry.value])).toEqual([
      [0, 1],
      [1, "missed"],
    ]);

    const received: string[] = [];
    await res.onFromAsync("ping", attachedAt, (value) => received.push(String(value)));
    expect(received).toEqual(["missed"]);

    beacon.fire("ping", "live");
    await waitFor(() => received.length === 2);
    expect(received).toEqual(["missed", "live"]);

    client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("resubscribes active event listeners after an automatic reconnect", async () => {
    const warehouse = new Warehouse();
    await warehouse.put("sys", new MemoryStore());
    const beacon = await warehouse.put("sys/beacon", new Beacon());
    await warehouse.open();
    const beaconId = beacon.instance!.id;
    const typeDef = warehouse.getTypeDef(Beacon);

    const server = await EpServer.listen({ port: 0, warehouse });
    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`, {
      autoReconnect: true,
      reconnectInterval: 200,
    });
    const res = (await client.attach(beaconId, typeDef)) as unknown as ListenableProxy;

    const received: string[] = [];
    res.on("ping", (v) => received.push(String(v)));
    await new Promise((r) => setTimeout(r, 100)); // let the initial Subscribe land

    beacon.fire("ping", "before");
    await waitFor(() => received.length === 1);

    // Simulate an unexpected disconnect — the server-side subscription state
    // (keyed by the now-dead connection) is gone, but the client's local
    // listener is untouched, so it still believes it's subscribed unless
    // resubscribeAfterReconnect() resets that belief.
    for (const connection of [...server.connections]) connection.close();
    await waitFor(() => !client.isConnected);
    await waitFor(() => server.connections.size === 0);

    // Historical events raised while disconnected are replayed exactly once
    // before live delivery resumes.
    beacon.fire("ping", "offline");

    await waitFor(() => client.isConnected);
    await new Promise((r) => setTimeout(r, 150)); // let post-reattach resubscribe land

    beacon.fire("ping", "after");
    await waitFor(() => received.length === 3);
    expect(received).toEqual(["before", "offline", "after"]);

    client.close();
    await server.close();
  });
});
