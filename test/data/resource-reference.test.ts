import { describe, expect, it } from "vitest";
import { compose, parseAsync } from "../../src/data/Codec.js";
import { ResourceId } from "../../src/data/ResourceId.js";
import type { RemoteTypeDefResolver } from "../../src/data/Tru.js";
import { TduIdentifier } from "../../src/data/TduIdentifier.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpResource } from "../../src/protocol/EpResource.js";
import { Resource } from "../../src/resource/Resource.js";
import { TypeDef } from "../../src/resource/template.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";

function resolver(): RemoteTypeDefResolver {
  return (() => {
    throw new Error("TypeDef resolution was not expected.");
  }) as RemoteTypeDefResolver;
}

describe("async resource-reference decoding", () => {
  it("resolves peer-owned references through the active value resolver", async () => {
    const valueResolver = resolver();
    const expected = { remote: 7 };
    valueResolver.resolveRemoteResource = async (id) => (id === 7 ? expected : undefined);

    await expect(
      parseAsync(Uint8Array.of(0x0c, 7), 0, null, valueResolver, null),
    ).resolves.toEqual({ value: expected, length: 2 });
  });

  it("resolves local references from the Warehouse", async () => {
    const expected = { local: 9 };
    const warehouse = { getById: (id: number) => (id === 9 ? expected : undefined) };

    await expect(
      parseAsync(Uint8Array.of(0x0b, 9), 0, warehouse, undefined, null),
    ).resolves.toEqual({ value: expected, length: 2 });
  });

  it("keeps a ResourceId placeholder when no connection resolver is available", async () => {
    const parsed = await parseAsync(Uint8Array.of(0x0c, 11), 0, null, undefined, null);
    expect(parsed.value).toEqual(new ResourceId(false, 11));
  });

  it("resolves resource links through the connection-aware resolver", async () => {
    const valueResolver = resolver();
    const expected = { path: "abc" };
    valueResolver.resolveResourceLink = async (link) => (link === "abc" ? expected : undefined);
    // Dynamic ResourceLink (0x45), one-byte length prefix, three UTF-8 bytes.
    const bytes = Uint8Array.of(0x4d, 3, 0x61, 0x62, 0x63);

    await expect(parseAsync(bytes, 0, null, valueResolver, null)).resolves.toEqual({
      value: expected,
      length: 5,
    });
  });
});

describe("resource-reference composition", () => {
  it("composes a warehouse-owned resource as a peer-owned RemoteResource", async () => {
    const warehouse = new Warehouse();
    await warehouse.put("sys", new MemoryStore());
    const resource = await warehouse.put("sys/local", new Resource());
    const connection = {};

    const bytes = compose(resource, warehouse, connection);
    expect(bytes[0]).toBe(TduIdentifier.RemoteResource8);
    expect(bytes[1]).toBe(resource.instance!.id);

    const valueResolver = resolver();
    valueResolver.resolveRemoteResource = async (id) =>
      id === resource.instance!.id ? resource : undefined;
    await expect(
      parseAsync(bytes, 0, warehouse, valueResolver, null),
    ).resolves.toEqual({ value: resource, length: bytes.length });
  });

  it.each([
    [0xff, TduIdentifier.LocalResource8, 2],
    [0x100, TduIdentifier.LocalResource16, 3],
    [0x1_0000, TduIdentifier.LocalResource32, 5],
  ] as const)(
    "composes a proxy owned by the destination connection using the minimal id width (%i)",
    (instanceId, identifier, length) => {
      const connection = {} as EpConnection;
      const proxy = new EpResource(connection, instanceId, new TypeDef("Remote", []));
      const bytes = compose(proxy, null, connection);

      expect(bytes[0]).toBe(identifier);
      expect(bytes).toHaveLength(length);
    },
  );

  it("composes homogeneous resource arrays as ResourceList values", async () => {
    const warehouse = new Warehouse();
    await warehouse.put("sys", new MemoryStore());
    const first = await warehouse.put("sys/first", new Resource());
    const second = await warehouse.put("sys/second", new Resource());

    const bytes = compose([first, second], warehouse, {});
    expect(bytes[0] & 0xc7).toBe(TduIdentifier.ResourceList);
  });
});
