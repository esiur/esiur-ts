import { describe, expect, it } from "vitest";
import { AsyncException } from "../../src/core/AsyncException.js";
import { ExceptionCode } from "../../src/core/ExceptionCode.js";
import { EpPacketRequest } from "../../src/net/packets/EpPacketRequest.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { Resource } from "../../src/resource/Resource.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";

async function createWarehouse(): Promise<Warehouse> {
  const warehouse = new Warehouse();
  await warehouse.put("sys", new MemoryStore());
  await warehouse.put("sys/a", new Resource());
  await warehouse.put("sys/b", new Resource());
  await warehouse.open();
  return warehouse;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("EP connection and resource attachment admission", () => {
  it("bounds resources imported by a client connection", async () => {
    const serverWarehouse = await createWarehouse();
    const clientWarehouse = new Warehouse();
    clientWarehouse.configuration.resourceAttachments.maximumAttachedResourcesPerConnection = 1;
    const server = await EpServer.listen({ port: 0, warehouse: serverWarehouse });
    const client = await EpConnection.connect(
      `ws://127.0.0.1:${server.port}`,
      clientWarehouse,
    );

    try {
      await client.get("sys/a");
      await expect(client.get("sys/b")).rejects.toMatchObject({
        code: ExceptionCode.AttachmentLimitExceeded,
      } as Partial<AsyncException>);
    } finally {
      client.close();
      await server.close();
      await serverWarehouse.close();
    }
  });

  it("bounds resources attached by a peer and rejects duplicate requests", async () => {
    const serverWarehouse = await createWarehouse();
    serverWarehouse.configuration.resourceAttachments.maximumAttachedResourcesPerConnection = 1;
    const clientWarehouse = new Warehouse();
    clientWarehouse.configuration.resourceAttachments.maximumAttachedResourcesPerConnection = 0;
    const server = await EpServer.listen({ port: 0, warehouse: serverWarehouse });
    const client = await EpConnection.connect(
      `ws://127.0.0.1:${server.port}`,
      clientWarehouse,
    );

    try {
      const first = await serverWarehouse.query("sys/a");
      expect(first).toBeDefined();
      await client.get("sys/a");
      await expect(
        client.sendRequest(EpPacketRequest.AttachResource, first!.instance!.id),
      ).rejects.toMatchObject({
        code: ExceptionCode.AlreadyAttached,
      } as Partial<AsyncException>);
      await expect(client.get("sys/b")).rejects.toMatchObject({
        code: ExceptionCode.AttachmentLimitExceeded,
      } as Partial<AsyncException>);
    } finally {
      client.close();
      await server.close();
      await serverWarehouse.close();
    }
  });

  it("bounds concurrent server connections and releases capacity on close", async () => {
    const warehouse = await createWarehouse();
    warehouse.configuration.connections.maximumConnections = 1;
    const server = await EpServer.listen({ port: 0, warehouse });
    const endpoint = `ws://127.0.0.1:${server.port}`;
    const first = await EpConnection.connect(endpoint);

    try {
      await expect(EpConnection.connect(endpoint)).rejects.toBeInstanceOf(AsyncException);
      first.close();
      await waitFor(() => server.connections.size === 0);
      const replacement = await EpConnection.connect(endpoint);
      replacement.close();
      await waitFor(() => server.connections.size === 0);
    } finally {
      first.close();
      await server.close();
      await warehouse.close();
    }
  });
});
