import { describe, expect, it } from "vitest";
import { merge, stringToBytes } from "../../src/data/DC.js";
import { t } from "../../src/data/descriptors.js";
import { EpConnection, EpConnectionContext } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { Export } from "../../src/resource/decorators.js";
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

interface TestAccount {
  identity: string;
  rawPassword: Uint8Array;
  salt: Uint8Array;
  hash: Uint8Array;
}

class SecureGreeter extends Resource {
  @Export(t.string, [t.string])
  greet(name: string): string {
    return `Hello ${name}`;
  }
}

const fixedSalt = Uint8Array.of(8, 6, 7, 5, 3, 0, 9);
const functionalClientPassword = Uint8Array.of(1, 2, 3, 4, 5);
const functionalServerSalt = Uint8Array.of(6, 7, 8, 9, 10);

function makeAccount(identity: string, password: string): TestAccount {
  const rawPassword = stringToBytes(password);
  const hash = PasswordAuthenticationHandler.computeSha3(merge(rawPassword, fixedSalt));
  return { identity, rawPassword, salt: fixedSalt, hash };
}

class StubProvider extends PasswordAuthenticationProvider {
  private readonly accounts = new Map<string, TestAccount>();

  constructor(
    private readonly self: string,
    accounts: TestAccount[],
  ) {
    super();
    for (const account of accounts) this.accounts.set(account.identity, account);
  }

  override getSelfIdentityAndCredential(): IdentityPassword {
    const account = this.accounts.get(this.self);
    return account
      ? new IdentityPassword(account.identity, account.rawPassword)
      : new IdentityPassword();
  }

  override getSelfCredential(identity: string): Uint8Array | null {
    return this.accounts.get(identity)?.rawPassword ?? null;
  }

  override getHostedAccountCredential(identity: string): PasswordHash {
    const account = this.accounts.get(identity);
    return account ? new PasswordHash(account.hash, account.salt) : new PasswordHash();
  }
}

class FunctionalClientAuthenticationProvider extends PasswordAuthenticationProvider {
  override getSelfIdentityAndCredential(
    domain: string | null,
    hostname: string | null,
  ): IdentityPassword {
    return domain === "test" && hostname === "localhost"
      ? new IdentityPassword("tester", functionalClientPassword)
      : new IdentityPassword();
  }

  override getSelfCredential(
    identity: string,
    domain: string | null,
    hostname: string | null,
  ): Uint8Array | null {
    return identity === "tester" && domain === "test" && hostname === "localhost"
      ? functionalClientPassword
      : null;
  }
}

class FunctionalServerAuthenticationProvider extends PasswordAuthenticationProvider {
  override getHostedAccountCredential(identity: string, domain: string | null): PasswordHash {
    return identity === "tester" && domain === "test"
      ? new PasswordHash(
          PasswordAuthenticationHandler.computeSha3(
            merge(functionalClientPassword, functionalServerSalt),
          ),
          functionalServerSalt,
        )
      : new PasswordHash();
  }
}

async function makeServer(account: TestAccount): Promise<{
  server: EpServer;
  warehouse: Warehouse;
  greeterId: number;
}> {
  const warehouse = new Warehouse();
  await warehouse.put("sys", new MemoryStore());
  const greeter = await warehouse.put("sys/greeter", new SecureGreeter());
  warehouse.registerAuthenticationProvider(new StubProvider("server", [account]));
  await warehouse.open();
  const server = await EpServer.listen({ port: 0, warehouse, allowUnauthorized: false });
  return { server, warehouse, greeterId: greeter.instance!.id };
}

describe("EpConnection password authentication", () => {
  it("authenticates with hash provider and serves resources", async () => {
    const account = makeAccount("alice", "correct horse battery staple");
    const { server, warehouse, greeterId } = await makeServer(account);

    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`, warehouse, {
      authenticationMode: AuthenticationMode.InitializerIdentity,
      identity: "alice",
      authenticationProvider: new StubProvider("alice", [account]),
    });

    expect(client.isAuthenticated).toBe(true);
    expect(client.authenticationSessionKey?.length).toBe(64);

    const typeDef = warehouse.getTypeDef(SecureGreeter);
    const proxy = (await client.attach(greeterId, typeDef)) as {
      greet(name: string): PromiseLike<string>;
    };
    expect(await proxy.greet("Ahmed")).toBe("Hello Ahmed");

    client.close();
    await server.close();
  });

  it("rejects wrong credentials", async () => {
    const account = makeAccount("alice", "the real password");
    const wrong = makeAccount("alice", "wrong password");
    const { server } = await makeServer(account);

    await expect(
      EpConnection.connect(`ws://127.0.0.1:${server.port}`, {
        authenticationMode: AuthenticationMode.InitializerIdentity,
        identity: "alice",
        authenticationProvider: new StubProvider("alice", [wrong]),
      }),
    ).rejects.toBeTruthy();

    await server.close();
  });

  it("accepts the .NET functional-test Warehouse.get + EpConnectionContext shape", async () => {
    const warehouse = new Warehouse();
    await warehouse.put("sys", new MemoryStore());
    await warehouse.put("sys/greeter", new SecureGreeter());
    warehouse.registerAuthenticationProvider(new FunctionalServerAuthenticationProvider());
    await warehouse.open();
    const server = await EpServer.listen({ port: 0, warehouse, allowUnauthorized: false });

    const clientWarehouse = new Warehouse();
    clientWarehouse.RegisterAuthenticationProvider(new FunctionalClientAuthenticationProvider());

    const connection = await clientWarehouse.Get<EpConnection>(
      `ep://localhost:${server.port}`,
      new EpConnectionContext({
        AuthenticationMode: AuthenticationMode.InitializerIdentity,
        AutoReconnect: true,
        Identity: "tester",
        AuthenticationProtocol: "hash",
        Domain: "test",
      }),
    );

    expect(connection).toBeInstanceOf(EpConnection);
    expect(connection?.isAuthenticated).toBe(true);
    expect(connection?.authenticationSessionKey?.length).toBe(64);

    const proxy = (await connection!.Get("sys/greeter", warehouse.getTypeDef(SecureGreeter))) as {
      greet(name: string): PromiseLike<string>;
    };
    expect(await proxy.greet("Functional")).toBe("Hello Functional");

    connection!.close();
    await server.close();
  });
});
