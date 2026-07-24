import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { AesEncryptionProvider } from "../../src/security/cryptography/AesEncryptionProvider.js";
import type { EncryptionContext } from "../../src/security/cryptography/EncryptionContext.js";
import { AuthenticationDirection } from "../../src/security/AuthenticationDirection.js";
import { AuthenticationMode } from "../../src/security/AuthenticationMode.js";
import { EncryptionMode } from "../../src/security/EncryptionMode.js";

function baseContext(overrides: Partial<EncryptionContext> = {}): EncryptionContext {
  return {
    key: randomBytes(32),
    direction: AuthenticationDirection.Initiator,
    mode: EncryptionMode.EncryptWithSessionKey,
    protocol: "aes-gcm",
    offeredProtocols: ["aes-gcm"],
    authenticationMode: AuthenticationMode.InitializerIdentity,
    authenticationProtocol: "password-sha3-v1",
    domain: "test",
    initiatorNonce: randomBytes(32),
    responderNonce: randomBytes(32),
    ...overrides,
  };
}

describe("AesEncryptionProvider", () => {
  it("advertises the aes-gcm protocol name and record overhead", () => {
    const provider = new AesEncryptionProvider();
    expect(provider.defaultName).toBe("aes-gcm");
    expect(provider.maximumRecordOverhead).toBe(24); // 8-byte sequence + 16-byte tag
  });

  it("round-trips a plaintext record between an initiator and a responder cipher", async () => {
    const provider = new AesEncryptionProvider();
    const shared = baseContext();

    const initiatorCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Initiator });
    const responderCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Responder });

    const plaintext = new TextEncoder().encode("hello, encrypted world");
    const record = initiatorCipher.encrypt(plaintext);
    expect(record.length).toBe(plaintext.length + 24);

    const decrypted = responderCipher.decrypt(record);
    expect(new TextDecoder().decode(decrypted)).toBe("hello, encrypted world");
  });

  it("encrypts multiple sequential records correctly in order", async () => {
    const provider = new AesEncryptionProvider();
    const shared = baseContext();
    const initiatorCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Initiator });
    const responderCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Responder });

    for (let i = 0; i < 5; i++) {
      const plaintext = Uint8Array.of(i, i + 1, i + 2);
      const record = initiatorCipher.encrypt(plaintext);
      expect([...responderCipher.decrypt(record)]).toEqual([i, i + 1, i + 2]);
    }
  });

  it("rejects a record with a wrong sequence (replay/reorder fails closed)", async () => {
    const provider = new AesEncryptionProvider();
    const shared = baseContext();
    const initiatorCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Initiator });
    const responderCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Responder });

    const first = initiatorCipher.encrypt(Uint8Array.of(1));
    const second = initiatorCipher.encrypt(Uint8Array.of(2));

    // Decrypting out of order (second before first) must fail.
    expect(() => responderCipher.decrypt(second)).toThrow(/sequence is invalid/);
    // The correctly-ordered first record still decrypts fine afterward.
    expect([...responderCipher.decrypt(first)]).toEqual([1]);
  });

  it("rejects a tampered ciphertext (authentication failure)", async () => {
    const provider = new AesEncryptionProvider();
    const shared = baseContext();
    const initiatorCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Initiator });
    const responderCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Responder });

    const record = initiatorCipher.encrypt(Uint8Array.of(9, 9, 9));
    const tampered = record.slice();
    tampered[tampered.length - 1] ^= 0xff; // flip a bit in the GCM tag

    expect(() => responderCipher.decrypt(tampered)).toThrow(/authentication failed/);
  });

  it("initiator/responder key and nonce derivation are direction-swapped, not identical", async () => {
    const provider = new AesEncryptionProvider();
    const shared = baseContext();
    const initiatorCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Initiator });
    const responderCipherWrongRole = await provider.createCipher({
      ...shared,
      direction: AuthenticationDirection.Initiator, // deliberately wrong: should be Responder
    });

    const record = initiatorCipher.encrypt(Uint8Array.of(1, 2, 3));
    // A cipher built with the *same* direction can't decrypt what the peer sent
    // (it derives the same send/receive key pair, not swapped complements).
    expect(() => responderCipherWrongRole.decrypt(record)).toThrow();
  });

  it("throws if the context binds a different negotiated protocol/domain than the peer", async () => {
    const provider = new AesEncryptionProvider();
    const shared = baseContext();
    const initiatorCipher = await provider.createCipher({ ...shared, direction: AuthenticationDirection.Initiator });
    // Responder derived keys from a *different* domain in the transcript — the HKDF salt differs.
    const responderCipher = await provider.createCipher({
      ...shared,
      direction: AuthenticationDirection.Responder,
      domain: "different-domain",
    });

    const record = initiatorCipher.encrypt(Uint8Array.of(1));
    expect(() => responderCipher.decrypt(record)).toThrow();
  });

  it("rejects setKey being called twice on the same cipher", async () => {
    const provider = new AesEncryptionProvider();
    const cipher = await provider.createCipher(baseContext());
    expect(() => cipher.setKey(randomBytes(32))).toThrow(/immutable/);
  });

  it("validates context invariants (shared key size, nonce size, mode)", async () => {
    const provider = new AesEncryptionProvider();
    await expect(provider.createCipher(baseContext({ key: randomBytes(8) }))).rejects.toThrow(
      /shared key must contain/,
    );
    await expect(
      provider.createCipher(baseContext({ initiatorNonce: randomBytes(4) })),
    ).rejects.toThrow(/initiatorNonce/);
    await expect(
      provider.createCipher(baseContext({ mode: EncryptionMode.None })),
    ).rejects.toThrow(/encrypted session mode/);
    await expect(
      provider.createCipher(baseContext({ authenticationMode: AuthenticationMode.None })),
    ).rejects.toThrow(/authenticated session/);
  });
});
