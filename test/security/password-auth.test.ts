import { describe, expect, it } from "vitest";
import { merge, stringToBytes, toHex } from "../../src/data/DC.js";
import { AuthenticationDirection } from "../../src/security/AuthenticationDirection.js";
import { AuthenticationMode } from "../../src/security/AuthenticationMode.js";
import { AuthenticationRuling } from "../../src/security/AuthenticationRuling.js";
import {
  IdentityPassword,
  PasswordAuthenticationHandler,
  PasswordAuthenticationProvider,
  PasswordHash,
} from "../../src/security/providers/index.js";

interface TestAccount {
  identity: string;
  rawPassword: Uint8Array;
  salt: Uint8Array;
  hash: Uint8Array;
}

const fixedSalt = Uint8Array.of(9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6);

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

function dataOf(result: { authenticationData: unknown }): unknown[] | null {
  return Array.isArray(result.authenticationData) ? result.authenticationData : null;
}

function newPair(
  mode: AuthenticationMode,
  initiatorSelf: string,
  responderSelf: string,
  accounts: TestAccount[],
): [PasswordAuthenticationHandler, PasswordAuthenticationHandler] {
  return [
    new PasswordAuthenticationHandler(
      mode,
      AuthenticationDirection.Initiator,
      mode === AuthenticationMode.ResponderIdentity ? null : initiatorSelf,
      null,
      "host",
      "domain",
      new StubProvider(initiatorSelf, accounts),
    ),
    new PasswordAuthenticationHandler(
      mode,
      AuthenticationDirection.Responder,
      null,
      mode === AuthenticationMode.InitializerIdentity ? null : responderSelf,
      "host",
      "domain",
      new StubProvider(responderSelf, accounts),
    ),
  ];
}

function runHandshake(mode: AuthenticationMode): [Uint8Array, Uint8Array] {
  const alice = makeAccount("alice", "correct horse battery staple");
  const server = makeAccount("server", "server password");
  const [initiator, responder] = newPair(mode, "alice", "server", [alice, server]);

  let next = initiator.process(null);
  expect(next.ruling).toBe(AuthenticationRuling.InProgress);

  for (let i = 0; i < 6; i++) {
    const responderResult = responder.process(dataOf(next));
    if (responderResult.ruling === AuthenticationRuling.Succeeded) {
      const finalInitiator = initiator.process(dataOf(responderResult));
      expect(finalInitiator.ruling).toBe(AuthenticationRuling.Succeeded);
      expect(finalInitiator.sessionKey).not.toBeNull();
      expect(responderResult.sessionKey).not.toBeNull();
      return [finalInitiator.sessionKey!, responderResult.sessionKey!];
    }
    expect(responderResult.ruling).toBe(AuthenticationRuling.InProgress);

    next = initiator.process(dataOf(responderResult));
    if (next.ruling === AuthenticationRuling.Succeeded) {
      const finalResponder = responder.process(dataOf(next));
      expect(finalResponder.ruling).toBe(AuthenticationRuling.Succeeded);
      expect(next.sessionKey).not.toBeNull();
      expect(finalResponder.sessionKey).not.toBeNull();
      return [next.sessionKey!, finalResponder.sessionKey!];
    }
    expect(next.ruling).toBe(AuthenticationRuling.InProgress);
  }

  throw new Error("Handshake did not complete.");
}

describe("SHA3", () => {
  it("matches standard empty-message vectors", () => {
    expect(toHex(PasswordAuthenticationHandler.computeSha3(new Uint8Array()))).toBe(
      "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
    );
    expect(toHex(PasswordAuthenticationHandler.computeSha3(new Uint8Array(), 512))).toBe(
      "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26",
    );
  });
});

describe("PasswordAuthenticationHandler", () => {
  it("derives matching session keys for initializer identity", () => {
    const [a, b] = runHandshake(AuthenticationMode.InitializerIdentity);
    expect(a.length).toBe(64);
    expect(a).toEqual(b);
  });

  it("derives matching session keys for responder identity", () => {
    const [a, b] = runHandshake(AuthenticationMode.ResponderIdentity);
    expect(a.length).toBe(64);
    expect(a).toEqual(b);
  });

  it("derives matching session keys for dual identity", () => {
    const [a, b] = runHandshake(AuthenticationMode.DualIdentity);
    expect(a.length).toBe(64);
    expect(a).toEqual(b);
  });

  it("fails closed for wrong password and malformed input", () => {
    const real = makeAccount("alice", "the real password");
    const wrong = makeAccount("alice", "a different password");
    const [initiator, responder] = newPair(
      AuthenticationMode.InitializerIdentity,
      "alice",
      "server",
      [wrong],
    );
    const serverResponder = new PasswordAuthenticationHandler(
      AuthenticationMode.InitializerIdentity,
      AuthenticationDirection.Responder,
      null,
      null,
      "host",
      "domain",
      new StubProvider("alice", [real]),
    );

    const r1 = initiator.process(null);
    const r2 = serverResponder.process(dataOf(r1));
    const r3 = initiator.process(dataOf(r2));
    expect(r3.ruling).toBe(AuthenticationRuling.Failed);

    expect(responder.process(null).ruling).toBe(AuthenticationRuling.Failed);
    expect(responder.process(["not-a-nonce", "alice"]).ruling).toBe(AuthenticationRuling.Failed);
    expect(responder.process([new Uint8Array(5), "alice"]).ruling).toBe(
      AuthenticationRuling.Failed,
    );
  });
});
