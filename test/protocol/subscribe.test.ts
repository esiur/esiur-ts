import { describe, it, expect, vi } from "vitest";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { WSocket } from "../../src/net/sockets/WSocket.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import { Resource } from "../../src/resource/Resource.js";
import { Export, AutoDelivered, event, type EventSource } from "../../src/resource/decorators.js";
import { t } from "../../src/data/descriptors.js";

class Beacon extends Resource {
  @Export(t.i32) accessor pings = 0;

  // Default: subscribable, requires an explicit Subscribe before occurrences flow.
  @Export(t.string) ping: EventSource<string> = event<string>();

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
      reconnectInterval: 20,
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

    await waitFor(() => client.isConnected);
    await new Promise((r) => setTimeout(r, 150)); // let post-reattach resubscribe land

    beacon.fire("ping", "after");
    await waitFor(() => received.length === 2);
    expect(received).toEqual(["before", "after"]);

    client.close();
    await server.close();
  });
});
