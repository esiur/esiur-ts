/**
 * A per-session symmetric record cipher (port of C# `ISymetricCipher`).
 * `encrypt`/`decrypt` are deliberately synchronous — they run on
 * `NetworkConnection`'s hot send/receive path, which has no async contract
 * (see `AesEncryptionProvider.ts` for how the Node-only implementation keeps
 * this true despite deriving key material asynchronously at construction).
 */
export interface ISymetricCipher {
  readonly identifier: number;
  encrypt(data: Uint8Array): Uint8Array;
  decrypt(data: Uint8Array): Uint8Array;
  /** Initialize the cipher key. Session ciphers are immutable after their one call. */
  setKey(key: Uint8Array): Uint8Array;
}
