/** Generate `length` cryptographically-random bytes. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const crypto = globalThis.crypto as
    | { getRandomValues?: (target: Uint8Array) => Uint8Array }
    | undefined;
  if (!crypto?.getRandomValues)
    throw new Error("Secure random bytes are unavailable in this environment.");
  crypto.getRandomValues(out);
  return out;
}
