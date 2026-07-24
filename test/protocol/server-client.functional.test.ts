import { describe, expect, it } from "vitest";
import { merge } from "../../src/data/DC.js";
import { t } from "../../src/data/descriptors.js";
import { EpConnection, EpConnectionContext } from "../../src/protocol/EpConnection.js";
import { EpResource, type RemotePropertyChange } from "../../src/protocol/EpResource.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { AutoDelivered, Export, event, type EventSource } from "../../src/resource/decorators.js";
import { Resource } from "../../src/resource/Resource.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { AuthenticationMode } from "../../src/security/AuthenticationMode.js";
import {
  IdentityPassword,
  PasswordAuthenticationHandler,
  PasswordAuthenticationProvider,
  PasswordHash,
} from "../../src/security/providers/index.js";
import { MemoryStore } from "../../src/stores/MemoryStore.js";
import type { IPermissionsManager } from "../../src/security/permissions/IPermissionsManager.js";
import { Ruling } from "../../src/security/permissions/Ruling.js";

/**
 * Matches esiur-dotnet's current default: any action not explicitly allowed
 * by `Warehouse.DefaultPermissions` (e.g. `SetProperty`) is denied unless a
 * permissions manager opines. This test isn't exercising the Permissions
 * system itself, so it registers a manager that allows everything.
 */
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

const clientPassword = Uint8Array.of(1, 2, 3, 4, 5);
const serverSalt = Uint8Array.of(6, 7, 8, 9, 10);

class FunctionalService extends Resource {
  @Export(t.i32) accessor level = 1;
  @Export(t.string) accessor status = "idle";
  // This test exercises general event delivery, not the subscribe/unsubscribe
  // flow itself (see subscribe.test.ts for that), so opt out of the new
  // subscribable-by-default requirement.
  @Export(t.string) @AutoDelivered() message: EventSource<string> = event<string>();

  @Export(t.string, [t.string])
  greet(name: string): string {
    this.level++;
    this.status = `greeted:${name}`;
    return `Hello ${name}:${this.level}`;
  }

  @Export(t.i32, [t.i32, t.i32])
  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  @Export(t.string, [t.string])
  raise(message: string): string {
    this.message.emit(message);
    return message.toUpperCase();
  }
}

class FunctionalClientAuthenticationProvider extends PasswordAuthenticationProvider {
  override getSelfIdentityAndCredential(
    domain: string | null,
    hostname: string | null,
  ): IdentityPassword {
    return domain === "test" && hostname === "localhost"
      ? new IdentityPassword("tester", clientPassword)
      : new IdentityPassword();
  }

  override getSelfCredential(
    identity: string,
    domain: string | null,
    hostname: string | null,
  ): Uint8Array | null {
    return identity === "tester" && domain === "test" && hostname === "localhost"
      ? clientPassword
      : null;
  }
}

class FunctionalServerAuthenticationProvider extends PasswordAuthenticationProvider {
  override getHostedAccountCredential(identity: string, domain: string | null): PasswordHash {
    return identity === "tester" && domain === "test"
      ? new PasswordHash(
          PasswordAuthenticationHandler.computeSha3(merge(clientPassword, serverSalt)),
          serverSalt,
        )
      : new PasswordHash();
  }
}

type FunctionalRemote = EpResource & {
  level: number;
  status: string;
  greet(name: string): PromiseLike<string>;
  add(a: number, b: number): PromiseLike<number>;
  raise(message: string): PromiseLike<string>;
};

describe("complete authenticated server/client flow", () => {
  it("serves a resource to an authenticated client, pushes updates/events, and reconnects", async () => {
    const serverWarehouse = new Warehouse();
    serverWarehouse.RegisterAuthenticationProvider(new FunctionalServerAuthenticationProvider());
    serverWarehouse.registerManager(new AllowAllPermissionsManager(), true);
    await serverWarehouse.put("sys", new MemoryStore());
    const service = await serverWarehouse.put("sys/service", new FunctionalService());
    await serverWarehouse.open();

    const server = await EpServer.listen({
      port: 0,
      warehouse: serverWarehouse,
      allowUnauthorized: false,
    });

    const clientWarehouse = new Warehouse();
    clientWarehouse.RegisterAuthenticationProvider(new FunctionalClientAuthenticationProvider());

    const connection = (await clientWarehouse.Get<EpConnection>(
      `ep://localhost:${server.port}`,
      new EpConnectionContext({
        AuthenticationMode: AuthenticationMode.InitializerIdentity,
        AuthenticationProtocol: "password-sha3-v1",
        AutoReconnect: true,
        ReconnectInterval: 25,
        Identity: "tester",
        Domain: "test",
      }),
    ))!;

    expect(connection).toBeInstanceOf(EpConnection);
    expect(connection.isAuthenticated).toBe(true);
    expect(connection.authenticationSessionKey?.length).toBe(64);

    const typeDef = serverWarehouse.getTypeDef(FunctionalService);
    const remote = (await connection.Get("sys/service", typeDef)) as FunctionalRemote;
    const propertyChanges: RemotePropertyChange[] = [];
    const events: RemotePropertyChange[] = [];
    remote.propertyModified.add((change) => propertyChanges.push(change));
    remote.eventOccurred.add((occurrence) => events.push(occurrence));

    expect(remote.level).toBe(1);
    expect(remote.status).toBe("idle");

    expect(await remote.greet("Mira")).toBe("Hello Mira:2");
    await waitFor(() => remote.level === 2 && remote.status === "greeted:Mira");
    expect(service.level).toBe(2);
    expect(propertyChanges.some((p) => p.name === "level" && p.value === 2)).toBe(true);
    expect(propertyChanges.some((p) => p.name === "status" && p.value === "greeted:Mira")).toBe(
      true,
    );

    expect(await remote.add(20, 22)).toBe(42);

    await connection.set(
      service.instance!.id,
      typeDef.getPropertyByName("status")!.index,
      "client-set",
    );
    await waitFor(() => service.status === "client-set" && remote.status === "client-set");

    expect(await remote.raise("ping")).toBe("PING");
    await waitFor(() => events.some((e) => e.name === "message" && e.value === "ping"));

    service.level = 7;
    await waitFor(() => remote.level === 7);

    for (const serverConnection of [...server.connections]) serverConnection.close();
    await waitFor(() => !connection.isConnected);

    service.level = 99;
    await waitFor(() => connection.isConnected && remote.level === 99, 2500);
    expect(connection.lastReconnectMetrics?.restoredResources).toBeGreaterThanOrEqual(1);
    expect(await remote.add(1, 2)).toBe(3);

    connection.close();
    await server.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}
