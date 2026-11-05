import { describe, expect, it } from "vitest";
import { t } from "../../src/data/descriptors.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { EpResource } from "../../src/protocol/EpResource.js";
import { EpPacketRequest } from "../../src/net/packets/EpPacketRequest.js";
import { EpMemberUnavailableError } from "../../src/protocol/EpMemberUnavailableError.js";
import type { TypeDef } from "../../src/resource/template.js";
import { Export } from "../../src/resource/decorators.js";
import { Resource } from "../../src/resource/Resource.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import type { IPermissionsManager } from "../../src/security/permissions/IPermissionsManager.js";
import { ActionType } from "../../src/security/permissions/ActionType.js";
import { Ruling } from "../../src/security/permissions/Ruling.js";
import type { IResource } from "../../src/resource/IResource.js";
import { sha256 } from "../../src/data/sha256.js";
import { name64 } from "../../src/data/typeDefSignature.js";
import { computeTypeDefSignature } from "../../src/protocol/typeDefSigning.js";
import { TypeDefKind } from "../../src/data/types/ITypeDef.js";
import { AsyncReply } from "../../src/core/AsyncReply.js";
import { RemoteTypeDef } from "../../src/protocol/RemoteTypeDef.js";

// docs/typedef-sync.md: a client that keeps definitions between connections must never bind a
// resource to the wrong definition after the serving node restarted and renumbered its types.

class AllowAllPermissionsManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  readonly settings = undefined;
  applicable(): Ruling {
    return Ruling.Allowed;
  }
  initialize(): boolean {
    return true;
  }
}

// Allows everything except viewing a definition without a resource, which is what a request by
// type id is: a node may let a peer view a definition only through a resource it may attach to.
class ResourceOnlyDefinitionsManager implements IPermissionsManager {
  readonly managerCategory = "permissions" as const;
  readonly settings = undefined;
  applicable(resource: IResource | null, _session: unknown, action: ActionType): Ruling {
    return action === ActionType.ViewTypeDef && resource === null ? Ruling.Denied : Ruling.Allowed;
  }
  initialize(): boolean {
    return true;
  }
}

class ProbeA extends Resource {
  @Export(t.i32) accessor alpha = 1;
}

class ProbeB extends Resource {
  @Export(t.string) accessor beta = "one";
}

// Two builds of the same service share a class name (each in its own function, so the bundler
// does not rename one of them); the second one added members in front, which shifts every index.
function probeV1() {
  class Probe extends Resource {
    @Export(t.i32) accessor level = 5;

    @Export(t.i32, [t.i32])
    echo(value: number): number {
      return value;
    }
  }
  return Probe;
}

function probeV2() {
  class Probe extends Resource {
    @Export(t.i32) accessor extra = 0;
    @Export(t.i32) accessor level = 9;

    @Export(t.string, [t.string])
    added(text: string): string {
      return text;
    }

    @Export(t.i32, [t.i32])
    echo(value: number): number {
      return value;
    }
  }
  return Probe;
}

// A later build that no longer has `echo`.
function probeV3() {
  class Probe extends Resource {
    @Export(t.i32) accessor level = 3;
  }
  return Probe;
}

// A compiled stub, generated against build 1: it carries that build's member indexes and passes
// them only as a fast path, resolving the current index by name.
class ProbeStub extends EpResource {
  static typeDef: TypeDef;

  get level(): number {
    return this._PropertyValue<number>("level", 0);
  }

  echo(value: number) {
    return this._Invoke(this._FunctionIndex("echo", 0), [value]);
  }
}

async function node(
  register: (warehouse: Warehouse) => Promise<void>,
  port = 0,
  manager: IPermissionsManager = new AllowAllPermissionsManager(),
) {
  const warehouse = new Warehouse();
  warehouse.registerManager(manager, true);
  await warehouse.put("sys", new MemoryStore());
  await register(warehouse);
  await warehouse.open();
  const server = await EpServer.listen({ port, warehouse });
  return { warehouse, server };
}

describe("TypeDef sync", () => {
  it("sha256 matches the standard test vectors", () => {
    const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex(sha256(new Uint8Array()))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(hex(sha256(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const long = new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq");
    expect(hex(sha256(long))).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("signature ignores ids and changes with members", async () => {
    const one = new Warehouse();
    const two = new Warehouse();
    // Different registration order gives the same class different ids in the two warehouses.
    two.getLocalTypeDefByType(ProbeB);
    const inOne = one.getLocalTypeDefByType(ProbeA);
    const inTwo = two.getLocalTypeDefByType(ProbeA);
    expect(inOne.id).not.toBe(inTwo.id);

    const signatureOne = computeTypeDefSignature(TypeDefKind.Resource, one.getTypeDef(ProbeA), one);
    const signatureTwo = computeTypeDefSignature(TypeDefKind.Resource, two.getTypeDef(ProbeA), two);
    expect(signatureOne).toBe(signatureTwo);
    expect(signatureOne).not.toBe(0n);

    const v1 = probeV1();
    const v2 = probeV2();
    const warehouse = new Warehouse();
    expect(computeTypeDefSignature(TypeDefKind.Resource, warehouse.getTypeDef(v1), warehouse)).not.toBe(
      computeTypeDefSignature(TypeDefKind.Resource, warehouse.getTypeDef(v2), warehouse),
    );
    expect(name64("a")).not.toBe(name64("b"));
  });

  it("keeps every resource on its own definition after a node renumbers its types", async () => {
    const first = await node(async (warehouse) => {
      warehouse.getLocalTypeDefByType(ProbeA);
      warehouse.getLocalTypeDefByType(ProbeB);
      await warehouse.put("sys/a", new ProbeA());
      await warehouse.put("sys/b", new ProbeB());
    });
    const second = await node(async (warehouse) => {
      warehouse.getLocalTypeDefByType(ProbeB);
      warehouse.getLocalTypeDefByType(ProbeA);
      const a = await warehouse.put("sys/a", new ProbeA());
      a.alpha = 2;
      const b = await warehouse.put("sys/b", new ProbeB());
      b.beta = "two";
    });

    const clientWarehouse = new Warehouse();
    const domain = "typedef-sync-test";
    const connectionOne = await EpConnection.connect(`ws://127.0.0.1:${first.server.port}`, clientWarehouse, { domain });
    const a1 = (await connectionOne.get("sys/a")) as unknown as { alpha: number };
    const b1 = (await connectionOne.get("sys/b")) as unknown as { beta: string };
    expect(a1.alpha).toBe(1);
    expect(b1.beta).toBe("one");

    const cached = clientWarehouse.getCachedRemoteTypeDefs(domain);
    const idsBefore = new Map(cached.map((definition) => [definition.name, definition.id]));
    expect(idsBefore.size).toBeGreaterThanOrEqual(2);

    const connectionTwo = await EpConnection.connect(`ws://127.0.0.1:${second.server.port}`, clientWarehouse, { domain });
    const a2 = (await connectionTwo.get("sys/a")) as unknown as { alpha: number };
    const b2 = (await connectionTwo.get("sys/b")) as unknown as { beta: string };

    // Bound to the right definitions, with the new node's values.
    expect(a2.alpha).toBe(2);
    expect(b2.beta).toBe("two");

    // The definition objects are the same ones, re-keyed to the ids the new node uses.
    const after = new Map(clientWarehouse.getCachedRemoteTypeDefs(domain).map((d) => [d.name, d]));
    for (const [name, idBefore] of idsBefore) {
      const definition = after.get(name)!;
      expect(definition).toBeDefined();
      expect(definition.removed).toBe(false);
      if (name.endsWith("ProbeA") || name.endsWith("ProbeB"))
        expect(definition.id).not.toBe(idBefore);
    }

    connectionOne.close();
    connectionTwo.close();
    await first.server.close();
    await second.server.close();
  });

  it("updates a changed definition in place and rebinds attached resources after a reconnect", { timeout: 20000 }, async () => {
    const v1 = probeV1();
    const first = await node(async (warehouse) => {
      await warehouse.put("sys/probe", new v1());
    });
    const port = first.server.port;

    const clientWarehouse = new Warehouse();
    const domain = "typedef-sync-restart";
    const client = await EpConnection.connect(`ws://127.0.0.1:${port}`, clientWarehouse, {
      domain,
      autoReconnect: true,
      reconnectInterval: 20,
    });
    const probeProxy = (await client.get("sys/probe")) as unknown as {
      level: number;
      echo(value: number): Promise<number>;
    };
    expect(probeProxy.level).toBe(5);
    expect(await probeProxy.echo(3)).toBe(3);

    const definitionBefore = clientWarehouse.getCachedRemoteTypeDefs(domain).find((d) => d.name.endsWith("Probe"))!;
    const signatureBefore = definitionBefore.signature;
    expect(signatureBefore).not.toBe(0n);

    // The node restarts as a newer build: a function was added in front, a property was added.
    for (const connection of [...first.server.connections]) connection.close();
    await first.server.close();
    const v2 = probeV2();
    const second = await node(async (warehouse) => {
      await warehouse.put("sys/probe", new v2());
    }, port);

    await waitFor(() => (probeProxy as { level: number }).level === 9, 5000);

    // Same definition object, updated in place with the new members and signature.
    const definitionAfter = clientWarehouse.getCachedRemoteTypeDefs(domain).find((d) => d.name.endsWith("Probe"))!;
    expect(definitionAfter).toBe(definitionBefore);
    expect(definitionAfter.signature).not.toBe(signatureBefore);
    expect(definitionAfter.template.getFunctionByName("added")).toBeDefined();

    // The attached proxy resolves members by name on the updated definition.
    expect(await probeProxy.echo(4)).toBe(4);

    client.close();
    await second.server.close();
  });

  it("does not wait forever for a node that ignores SyncTypeDefs", async () => {
    const warehouse = new Warehouse();
    const connection = new EpConnection();
    connection.warehouse = warehouse;
    (connection as unknown as { domain: string }).domain = "silent";

    const definition = new RemoteTypeDef();
    definition.hydrate(1n, TypeDefKind.Resource, "Silent", 0, undefined, undefined, [], [], [], [], {
      signature: 5n,
    });
    warehouse.cacheRemoteTypeDef("silent", definition);

    // A node that predates the request never answers it.
    connection.sendRequest = (() => new AsyncReply()) as EpConnection["sendRequest"];

    const previous = EpConnection.typeDefSyncTimeoutMs;
    EpConnection.typeDefSyncTimeoutMs = 30;
    try {
      await (connection as unknown as { syncTypeDefCache(): Promise<void> }).syncTypeDefCache();
    } finally {
      EpConnection.typeDefSyncTimeoutMs = previous;
    }

    // Establishment carried on, with the cache dropped instead of trusted.
    expect(warehouse.getCachedRemoteTypeDefs("silent")).toHaveLength(0);
  });

  it("a compiled stub keeps working when the node renumbers its members", async () => {
    const v1 = probeV1();
    ProbeStub.typeDef = new Warehouse().getTypeDef(v1);
    const v2 = probeV2();
    const second = await node(async (warehouse) => {
      await warehouse.put("sys/probe", new v2());
    });

    const client = await EpConnection.connect(`ws://127.0.0.1:${second.server.port}`, new Warehouse(), {
      domain: "typedef-sync-stub",
    });
    const stub = (await client.get("sys/probe", ProbeStub)) as unknown as ProbeStub;

    // build 2 put `extra` first and `added` in front of `echo`: every index differs from the stub's
    expect(stub.level).toBe(9);
    expect(await stub.echo(4)).toBe(4);

    client.close();
    await second.server.close();
  });

  it("asks for the node's definition in the same flight as the attach of a compiled stub", async () => {
    const v1 = probeV1();
    ProbeStub.typeDef = new Warehouse().getTypeDef(v1);
    const served = await node(async (warehouse) => {
      await warehouse.put("sys/probe", new v1());
    });

    const client = await EpConnection.connect(`ws://127.0.0.1:${served.server.port}`, new Warehouse(), {
      domain: "typedef-sync-pipelined",
    });
    const events = recordRequests(client);
    const stub = (await client.get("sys/probe", ProbeStub)) as unknown as ProbeStub;
    expect(stub.level).toBe(5);

    // Both requests were on the wire before either was answered: binding the stub by name costs
    // no round trip on top of the attach, and the by-id fetch is not needed afterwards.
    const at = (event: string) => events.indexOf(event);
    expect(at("send AttachResource")).toBeGreaterThanOrEqual(0);
    expect(at("send TypeDefByResourceId")).toBeGreaterThanOrEqual(0);
    expect(at("send TypeDefByResourceId")).toBeLessThan(at("reply AttachResource"));
    expect(at("send AttachResource")).toBeLessThan(at("reply TypeDefByResourceId"));
    expect(events).not.toContain("send TypeDefById");

    client.close();
    await served.server.close();
  });

  it("needs no definition request for a compiled stub once the connection validated its cache", async () => {
    const v1 = probeV1();
    ProbeStub.typeDef = new Warehouse().getTypeDef(v1);
    const served = await node(async (warehouse) => {
      await warehouse.put("sys/probe", new v1());
    });
    const url = `ws://127.0.0.1:${served.server.port}`;
    const warehouse = new Warehouse();
    const domain = "typedef-sync-warm-stub";

    const first = await EpConnection.connect(url, warehouse, { domain });
    expect(((await first.get("sys/probe", ProbeStub)) as unknown as ProbeStub).level).toBe(5);
    first.close();

    // The second connection validates the cache while it is established.
    const second = await EpConnection.connect(url, warehouse, { domain });
    const events = recordRequests(second);
    const stub = (await second.get("sys/probe", ProbeStub)) as unknown as ProbeStub;
    expect(stub.level).toBe(5);
    expect(await stub.echo(7)).toBe(7);
    expect(events.filter((event) => /^send TypeDef/.test(event))).toEqual([]);

    second.close();
    await served.server.close();
  });

  it("attaches first and asks for a definition by id only when the connection lacks it", async () => {
    const served = await node(async (warehouse) => {
      await warehouse.put("sys/a", new ProbeA());
      await warehouse.put("sys/a2", new ProbeA());
    });

    const client = await EpConnection.connect(`ws://127.0.0.1:${served.server.port}`, new Warehouse(), {
      domain: "typedef-sync-attach-order",
    });
    const events = recordRequests(client);
    const first = (await client.get("sys/a")) as unknown as { alpha: number };
    const second = (await client.get("sys/a2")) as unknown as { alpha: number };
    expect([first.alpha, second.alpha]).toEqual([1, 1]);

    // The first resource of a type names it in the attach reply and the definition is fetched
    // once, by id; the second resource of that type finds it in the connection's map.
    expect(sentRequests(events)).toEqual([
      "GetResourceIdByLink",
      "AttachResource",
      "TypeDefById",
      "GetResourceIdByLink",
      "AttachResource",
    ]);

    client.close();
    await served.server.close();
  });

  it("needs no definition request for a plain attach once the connection validated its cache", async () => {
    const served = await node(async (warehouse) => {
      await warehouse.put("sys/a", new ProbeA());
    });
    const url = `ws://127.0.0.1:${served.server.port}`;
    const warehouse = new Warehouse();
    const domain = "typedef-sync-warm-attach";

    const first = await EpConnection.connect(url, warehouse, { domain });
    expect(((await first.get("sys/a")) as unknown as { alpha: number }).alpha).toBe(1);
    first.close();

    // The second connection validates the cache while it is established; the definition it
    // seeded is what the attach reply's type id finds.
    const second = await EpConnection.connect(url, warehouse, { domain });
    const events = recordRequests(second);
    const resource = (await second.get("sys/a")) as unknown as { alpha: number };
    expect(resource.alpha).toBe(1);
    expect(sentRequests(events)).toEqual(["GetResourceIdByLink", "AttachResource"]);

    second.close();
    await served.server.close();
  });

  it("asks through the resource when the node does not serve the definition by id", async () => {
    const served = await node(
      async (warehouse) => {
        await warehouse.put("sys/a", new ProbeA());
      },
      0,
      new ResourceOnlyDefinitionsManager(),
    );

    const client = await EpConnection.connect(`ws://127.0.0.1:${served.server.port}`, new Warehouse(), {
      domain: "typedef-sync-resource-only",
    });
    const events = recordRequests(client);
    const resource = (await client.get("sys/a")) as unknown as { alpha: number };
    expect(resource.alpha).toBe(1);

    expect(sentRequests(events)).toEqual([
      "GetResourceIdByLink",
      "AttachResource",
      "TypeDefById",
      "TypeDefByResourceId",
    ]);

    client.close();
    await served.server.close();
  });

  it("fails with a clear error for a member the node removed", async () => {
    const v1 = probeV1();
    const contract = new Warehouse().getTypeDef(v1);
    ProbeStub.typeDef = contract;
    const v3 = probeV3();
    const third = await node(async (warehouse) => {
      await warehouse.put("sys/probe", new v3());
    });

    const client = await EpConnection.connect(`ws://127.0.0.1:${third.server.port}`, new Warehouse(), {
      domain: "typedef-sync-removed",
    });

    // A compiled stub: the function that is gone throws, the property that is still there works.
    const stub = (await client.get("sys/probe", ProbeStub)) as unknown as ProbeStub;
    expect(stub.level).toBe(3);
    let error: unknown;
    try {
      stub.echo(1);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EpMemberUnavailableError);
    expect(error).toMatchObject({ memberName: "echo", memberKind: "function", typeName: "Probe" });
    expect((error as Error).message).toContain("update the client");

    // The ergonomic proxy of an attach with the old contract fails the same way.
    const instanceId = (stub as unknown as { instanceId: number }).instanceId;
    const proxy = (await client.attach(instanceId + 0, contract)) as unknown as {
      level: number;
      echo(value: number): unknown;
    };
    expect(proxy.level).toBe(3);
    expect(() => proxy.echo(1)).toThrow(EpMemberUnavailableError);

    client.close();
    await third.server.close();
  });
});

/** The names of the requests in a recording, in the order they were sent. */
function sentRequests(events: string[]): string[] {
  return events.filter((event) => event.startsWith("send ")).map((event) => event.slice(5));
}

/** Records "send <request>" and "reply <request>" in the order they happen on a connection. */
function recordRequests(connection: EpConnection): string[] {
  const events: string[] = [];
  const send = connection.sendRequest.bind(connection) as (...args: unknown[]) => AsyncReply;
  connection.sendRequest = ((action: EpPacketRequest, ...rest: unknown[]) => {
    events.push(`send ${EpPacketRequest[action]}`);
    const reply = send(action, ...rest);
    reply.onReady(() => events.push(`reply ${EpPacketRequest[action]}`));
    return reply;
  }) as EpConnection["sendRequest"];
  return events;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}
