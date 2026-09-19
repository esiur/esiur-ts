import { describe, it, expect } from "vitest";
import { EpConnection } from "../src/protocol/EpConnection.js";
import { ResourceId } from "../src/data/ResourceId.js";
import { Resource } from "../src/resource/Resource.js";
import {
  Export,
  Historical,
  event,
  getTemplate,
  type EventSource,
} from "../src/resource/decorators.js";
import { t } from "../src/data/descriptors.js";
import { OrderingControl } from "../src/data/OrderingControl.js";
import { OperationEffects } from "../src/data/types/OperationEffects.js";

// Client-side stub matching the C# `Hello` resource (interop/Hello.cs):
// counts (int, prop 0), label (string, prop 1), SayHi(string) (func 0).
class HelloStub extends Resource {
  @Export(t.i32) @Historical() accessor counts = 0;
  @Export(t.string) accessor label = "";
  // C# reflection orders these functions alphabetically by member name.
  @Export(t.resource, [t.resource]) echoResource(_resource: unknown): unknown {
    return undefined;
  }
  @Export(t.void, [t.string]) firePing(_message: string): void {}
  @Export(t.string, [t.string]) sayHi(_msg: string): string {
    return "";
  }
  @Export(t.string) @Historical() ping: EventSource<string> = event<string>();
}

/**
 * Cross-language test: the TypeScript client connects to the *real C# Esiur
 * server* (interop/Program.cs, EpServer on the default or caller-provided port with
 * AllowUnauthorizedAccess) and completes the anonymous IIP handshake.
 *
 * Run the C# server first:
 *   dotnet interop/bin/Release/net10.0/InteropServer.dll
 * then: npx vitest run interop/client.test.ts
 */
describe("cross-language: TS client ↔ C# Esiur server", () => {
  const configuredPort = process.env.ESIUR_INTEROP_PORT;
  const port = configuredPort == null ? undefined : Number(configuredPort);
  if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535))
    throw new Error("ESIUR_INTEROP_PORT must be from 1 through 65535.");
  const endpoint = port === undefined ? "ws://127.0.0.1" : `ws://127.0.0.1:${port}`;

  it("completes the anonymous handshake over WebSocket", async () => {
    const client = await EpConnection.connect(endpoint);
    expect(client.isConnected).toBe(true);
    client.close();
  }, 15000);

  it("resolves a resource link to a resource id (request/reply both ways)", async () => {
    const client = await EpConnection.connect(endpoint);

    // TS composes the link string → C# parses it, queries the resource, and
    // replies with a resource reference → TS decodes it to a ResourceId.
    const rid = await client.getResourceIdByLink("sys/hello");
    expect(rid).toBeInstanceOf(ResourceId);
    expect((rid as ResourceId).id).toBeGreaterThan(0);

    // A missing path returns a management error (ResourceNotFound).
    await expect(
      client.getResourceIdByLink("sys/does-not-exist") as PromiseLike<unknown>,
    ).rejects.toBeTruthy();

    client.close();
  }, 15000);

  it("attaches a C# resource: reads properties, invokes a function, tracks changes", async () => {
    const client = await EpConnection.connect(endpoint);
    const rid = (await client.getResourceIdByLink("sys/hello")) as ResourceId;

    const res = (await client.attach(rid.id, getTemplate(HelloStub))) as Record<
      string,
      unknown
    > & {
      counts: number;
      label: string;
      echoResource: (resource: unknown) => PromiseLike<{ instanceId: number }>;
      sayHi: (m: string) => PromiseLike<string>;
    };

    // Property values came from the C# server's attach reply.
    expect(res.label).toBe("Hello from C#");
    const initialCounts = res.counts;
    expect(initialCounts).toBeGreaterThanOrEqual(0);

    // Invoke the C# function; its return value comes back over the wire.
    expect(await res.sayHi("Ahmed")).toBe("Welcome, Ahmed");

    // The proxy crosses TS → C# as a LocalResource reference, then returns
    // C# → TS as a RemoteResource reference and resolves to the same resource.
    const echoed = await res.echoResource(res);
    expect(echoed.instanceId).toBe(rid.id);

    // The C# side incremented Counts and pushed a PropertyModified notification.
    expect(res.counts).toBe(initialCounts + 1);

    client.close();
  }, 15000);

  it("receives the complete dotnet TypeDef member metadata surface", async () => {
    const client = await EpConnection.connect(endpoint);
    const rid = (await client.getResourceIdByLink("sys/hello")) as ResourceId;
    const typeDef = await client.fetchTypeDefByResourceId(rid.id);

    expect(typeDef).toMatchObject({
      usage: "Exercises the complete cross-runtime TypeDef contract.",
      description: "Interop resource metadata fixture",
      example: "sys/hello",
      category: "Conformance",
      since: "3.1",
    });

    const counts = typeDef.remoteProperties.find((property) =>
      property.name.toLowerCase() === "counts");
    expect(counts).toMatchObject({
      readOnly: true,
      hasHistory: true,
      deprecated: true,
      deprecationMessage: "Use the audit journal for durable totals",
      description: "Number of calls handled",
      usage: "Display the interop activity count",
      examples: [7],
      tags: ["interop", "counter"],
      unit: "calls",
      minimum: 0,
      maximum: 1000000,
      allowedValues: [0, 1],
      pattern: "^[0-9]+$",
      format: "N0",
      warnings: ["Resets when the test process exits"],
      relatedMembers: [0],
      defaultValue: 0,
    });

    const sayHi = typeDef.remoteFunctions.find((fn) => fn.name.toLowerCase() === "sayhi");
    expect(sayHi).toMatchObject({
      readOnly: true,
      idempotent: true,
      cancellable: true,
      deprecated: true,
      deprecationMessage: "Use a production greeting service",
      description: "Returns a greeting",
      usage: "Validate a request/reply invocation",
      examples: ["Ahmed"],
      tags: ["interop", "function"],
      format: "text",
      preconditions: ["The connection is authenticated"],
      postconditions: ["A greeting is returned"],
      effects: OperationEffects.External,
      warnings: ["Only intended for protocol conformance"],
      relatedMembers: [0],
    });

    const ping = typeDef.remoteEvents.find((event) => event.name.toLowerCase() === "ping");
    expect(ping).toMatchObject({
      historical: true,
      deprecated: true,
      deprecationMessage: "Use a production event channel",
      description: "Raised after an interop ping",
      usage: "Replay and subscribe to ping events",
      examples: ["online"],
      tags: ["interop", "event"],
      unit: "message",
      format: "text",
      warnings: ["Test event"],
      relatedMembers: [0],
      orderingControl: OrderingControl.LatestOnly,
    });

    client.close();
  }, 15000);

  it("queries C# children as auto-attached resource references", async () => {
    const client = await EpConnection.connect(endpoint);
    const children = await client.queryResources("sys/hello");

    expect(children).toHaveLength(1);
    expect(children[0].link).toBe("sys/hello/kid");
    expect(children[0].instanceId).toBeGreaterThan(0);
    client.close();
  }, 15000);

  it("queries and replays a historical C# event using the shared cursor protocol", async () => {
    const client = await EpConnection.connect(endpoint);
    const rid = (await client.getResourceIdByLink("sys/hello")) as ResourceId;
    const res = (await client.attach(rid.id, getTemplate(HelloStub))) as {
      cursor: import("../src/resource/ResourceCursor.js").ResourceCursor;
      firePing(message: string): PromiseLike<void>;
      queryJournal(query: unknown): PromiseLike<import("../src/resource/ResourceJournal.js").ResourceJournalPage>;
      onFromAsync(
        name: string,
        cursor: import("../src/resource/ResourceCursor.js").ResourceCursor,
        callback: (value: unknown) => void,
      ): PromiseLike<unknown>;
    };
    const attachedAt = res.cursor;

    await res.firePing("offline-for-subscriber");
    const page = await res.queryJournal({ after: attachedAt });
    expect(page.entries.map((entry) => entry.value)).toEqual([
      expect.any(Number),
      "offline-for-subscriber",
    ]);

    const received: string[] = [];
    await res.onFromAsync("ping", attachedAt, (value) => received.push(String(value)));
    expect(received).toEqual(["offline-for-subscriber"]);

    await res.firePing("live");
    await waitFor(() => received.length === 2);
    expect(received).toEqual(["offline-for-subscriber", "live"]);
    client.close();
  }, 15000);

  it("switches dense C# flow graphs without leaving resource or invocation requests pending", async () => {
    const client = await EpConnection.connect(endpoint);
    const workspace = await within(client.get("sys/workspace"), 5_000, "attach workspace") as {
      instanceId: number;
      resourceDefinition: {
        getFunctionByName(name: string): { index: number } | undefined;
      };
    };

    const revisionFunction = workspace.resourceDefinition.getFunctionByName("GetFlowRevision");
    const snapshotFunction = workspace.resourceDefinition.getFunctionByName("GetFlowSnapshot");
    const pulseFunction = workspace.resourceDefinition.getFunctionByName("Pulse");
    expect(revisionFunction).toBeDefined();
    expect(snapshotFunction).toBeDefined();
    expect(pulseFunction).toBeDefined();

    const switchFlow = async (flowId: number) => {
      // Starting the control-plane request and root attachment together is the
      // browser's workspace-switch pressure pattern: replies, remote TypeDefs,
      // recursive resource values, and property notifications share one link.
      const revision = client.invoke(workspace.instanceId, revisionFunction!.index, flowId);
      const root = client.get(`sys/workspace/flows/${flowId}/blocks/${flowId * 1000}`);
      const snapshot = client.invoke(workspace.instanceId, snapshotFunction!.index, flowId);
      const [revisionJson, attachedRoot, typedSnapshot] = await within(
        Promise.all([revision, root, snapshot]),
        8_000,
        `switch flow ${flowId}`,
      );

      expect(JSON.parse(String(revisionJson))).toMatchObject({ flowId });
      expect((attachedRoot as { link: string }).link).toContain(`/flows/${flowId}/`);
      expect(typedSnapshot).toMatchObject({ FlowId: flowId });
    };

    // Overlap several A→B→C transitions while the server emits updates for
    // every block. Repeating the sequence also exercises already-attached and
    // coalesced-pending paths on the same connection.
    const switches = Array.from({ length: 6 }, (_, pass) =>
      [1, 2, 3].map((flowId) => switchFlow(flowId).then(() => ({ pass, flowId })))
    ).flat();
    const pulses = Array.from({ length: 6 }, (_, seed) =>
      within(
        client.invoke(workspace.instanceId, pulseFunction!.index, seed),
        5_000,
        `pulse ${seed}`,
      )
    );

    const switched = await within(Promise.all(switches), 12_000, "all flow switches");
    await within(Promise.all(pulses), 12_000, "all flow pulses");
    expect(switched).toHaveLength(18);

    // A failed lookup must reject promptly and must not poison the next valid
    // request on the same connection.
    await expect(
      within(client.get("sys/workspace/flows/99/blocks/99000"), 2_000, "missing block"),
    ).rejects.toBeTruthy();
    await switchFlow(2);

    client.close();
  }, 30000);
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}

async function within<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${operation} did not finish within ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
