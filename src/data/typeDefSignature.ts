import { sha256 } from "./sha256.js";

// Id-independent signature of a type definition (docs/typedef-sync.md).
//
// signature = LE64(first 8 bytes of SHA-256(canonical)), where canonical is the normal wire
// encoding of the definition's TypeDefInfo with every id replaced by a hash of the name it stands
// for. A node computes it for its own definitions; a client stores and echoes what the node sent.

const state = { depth: 0 };

/** True while a signature is being composed: type references are then written by name hash. */
export function isComputingTypeDefSignature(): boolean {
  return state.depth > 0;
}

/** Runs `compose` in signature mode. */
export function composeForSignature<T>(compose: () => T): T {
  state.depth++;
  try {
    return compose();
  } finally {
    state.depth--;
  }
}

/** First 8 bytes of SHA-256(UTF-8(name)), little endian. */
export function name64(name: string): bigint {
  return readUInt64(sha256(new TextEncoder().encode(name)));
}

/** The signature of already composed canonical bytes; zero is reserved for "unknown". */
export function signatureOf(canonical: Uint8Array): bigint {
  const signature = readUInt64(sha256(canonical));
  return signature === 0n ? 1n : signature;
}

function readUInt64(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}
