import type { EncryptionContext } from "./EncryptionContext.js";
import type { ISymetricCipher } from "./ISymetricCipher.js";

/**
 * Creates a per-session symmetric cipher from authenticated session material
 * (port of C# `IEncryptionProvider`). Providers are registered and
 * negotiated by {@link defaultName}.
 *
 * `createCipher` is async (unlike C#'s synchronous method) purely so a
 * Node-only implementation can dynamically import `node:crypto` once, at
 * cipher-creation time — this runs once per session during the handshake,
 * not on the hot per-record path, so it doesn't ripple into
 * `ISymetricCipher.encrypt`/`decrypt`'s (or `ISocket.send`'s) synchronous
 * contract.
 */
export interface IEncryptionProvider {
  readonly defaultName: string;
  /**
   * Maximum bytes {@link ISymetricCipher.encrypt} adds to one plaintext
   * record. Used to reject an oversized send before it consumes a cipher
   * sequence number.
   */
  readonly maximumRecordOverhead: number;
  createCipher(context: EncryptionContext): Promise<ISymetricCipher>;
}
