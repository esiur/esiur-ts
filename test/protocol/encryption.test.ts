import { describe, expect, it } from "vitest";
import { merge, stringToBytes } from "../../src/data/DC.js";
import { t } from "../../src/data/descriptors.js";
import { EpConnection } from "../../src/protocol/EpConnection.js";
import { EpServer } from "../../src/protocol/EpServer.js";
import { Export } from "../../src/resource/decorators.js";
import { Resource } from "../../src/resource/Resource.js";
import { Warehouse } from "../../src/resource/Warehouse.js";
import { AuthenticationMode } from "../../src/security/AuthenticationMode.js";
import { EncryptionMode } from "../../src/security/EncryptionMode.js";
import { AesEncryptionProvider } from "../../src/security/cryptography/AesEncryptionProvider.js";
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

async function makeServer(
  account: TestAccount,
  withEncryption = true,
): Promise<{ server: EpServer; warehouse: Warehouse; greeterId: number }> {
  const warehouse = new Warehouse();
  await warehouse.put("sys", new MemoryStore());
  const greeter = await warehouse.put("sys/greeter", new SecureGreeter());
  warehouse.registerAuthenticationProvider(new StubProvider("server", [account]));
  if (withEncryption) warehouse.registerEncryptionProvider(new AesEncryptionProvider());
  await warehouse.open();
  const server = await EpServer.listen({ port: 0, warehouse, allowUnauthorized: false });
  return { server, warehouse, greeterId: greeter.instance!.id };
}

describe("EpConnection AES-GCM transport encryption", () => {
  it("negotiates encryption, authenticates, and serves resources over an encrypted transport", async () => {
    const account = makeAccount("alice", "correct horse battery staple");
    const { server, warehouse, greeterId } = await makeServer(account);

    const clientWarehouse = new Warehouse();
    clientWarehouse.registerEncryptionProvider(new AesEncryptionProvider());

    const client = await EpConnection.connect(`ws://127.0.0.1:${server.port}`, clientWarehouse, {
      authenticationMode: AuthenticationMode.InitializerIdentity,
      encryptionMode: EncryptionMode.EncryptWithSessionKey,
      identity: "alice",
      authenticationProvider: new StubProvider("alice", [account]),
    });

    expect(client.isAuthenticated).toBe(true);
    expect(client.authenticationSessionKey?.length).toBe(64);

    const typeDef = warehouse.getTypeDef(SecureGreeter);
    const proxy = (await client.attach(greeterId, typeDef)) as {
      greet(name: string): PromiseLike<string>;
    };

    // Exercise several request/reply round-trips over the encrypted
    // transport in both directions (client->server request, server->client
    // reply), each its own AES-GCM record with an incrementing sequence.
    expect(await proxy.greet("Ahmed")).toBe("Hello Ahmed");
    expect(await proxy.greet("Second call")).toBe("Hello Second call");
    expect(await proxy.greet("Third call")).toBe("Hello Third call");

    client.close();
    await server.close();
  });

  it("fails the handshake when the server has no matching encryption provider", async () => {
    const account = makeAccount("bob", "another password");
    const { server } = await makeServer(account, /* withEncryption */ false);

    const clientWarehouse = new Warehouse();
    clientWarehouse.registerEncryptionProvider(new AesEncryptionProvider());

    await expect(
      EpConnection.connect(`ws://127.0.0.1:${server.port}`, clientWarehouse, {
        authenticationMode: AuthenticationMode.InitializerIdentity,
        encryptionMode: EncryptionMode.EncryptWithSessionKey,
        identity: "bob",
        authenticationProvider: new StubProvider("bob", [account]),
      }),
    ).rejects.toBeTruthy();

    await server.close();
  });

  it("fails when encryption is requested without authentication", async () => {
    const account = makeAccount("carol", "yet another password");
    const { server } = await makeServer(account);

    const clientWarehouse = new Warehouse();
    clientWarehouse.registerEncryptionProvider(new AesEncryptionProvider());

    await expect(
      EpConnection.connect(`ws://127.0.0.1:${server.port}`, clientWarehouse, {
        // No authenticationMode set (defaults to None) but encryption requested.
        encryptionMode: EncryptionMode.EncryptWithSessionKey,
      }),
    ).rejects.toBeTruthy();

    await server.close();
  });
});
