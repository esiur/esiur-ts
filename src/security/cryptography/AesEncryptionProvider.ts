import { merge, stringToBytes, uint32ToBytes, uint64ToBytes } from "../../data/DC.js";
import { Endian } from "../../data/Endian.js";
import { AuthenticationDirection } from "../AuthenticationDirection.js";
import { AuthenticationMode } from "../AuthenticationMode.js";
import { EncryptionMode } from "../EncryptionMode.js";
import type { EncryptionContext } from "./EncryptionContext.js";
import type { IEncryptionProvider } from "./IEncryptionProvider.js";
import type { ISymetricCipher } from "./ISymetricCipher.js";

type NodeCrypto = typeof import("node:crypto");

const KEY_SIZE = 32;
const NONCE_PREFIX_SIZE = 4;
const SEQUENCE_SIZE = 8;
const TAG_SIZE = 16;
const RECORD_OVERHEAD = SEQUENCE_SIZE + TAG_SIZE;
const MIN_SHARED_KEY = 16;
const MAX_SHARED_KEY = 1024;
const MIN_PEER_NONCE = 16;
const MAX_PEER_NONCE = 64;
const MAX_SEQUENCE = 0xffffffffffffffffn;

const CONTEXT_LABEL = stringToBytes("esiur/ep/aes-256-gcm/context/v3");
const INITIATOR_TO_RESPONDER_KEY_LABEL = stringToBytes(
  "esiur/ep/aes-256-gcm/v1/initiator-to-responder/key",
);
const RESPONDER_TO_INITIATOR_KEY_LABEL = stringToBytes(
  "esiur/ep/aes-256-gcm/v1/responder-to-initiator/key",
);
const INITIATOR_TO_RESPONDER_NONCE_LABEL = stringToBytes(
  "esiur/ep/aes-256-gcm/v1/initiator-to-responder/nonce",
);
const RESPONDER_TO_INITIATOR_NONCE_LABEL = stringToBytes(
  "esiur/ep/aes-256-gcm/v1/responder-to-initiator/nonce",
);

/**
 * Creates AES-256-GCM record ciphers (port of C# `AesEncryptionProvider`).
 * Session keys and nonce prefixes are derived with HKDF-SHA256 and separated
 * by protocol direction and purpose.
 *
 * Node-only: `node:crypto` is loaded via a dynamic `import()` inside
 * {@link createCipher} (called once per session, during the handshake) —
 * matching `TcpSocket.ts`'s environment-detection convention. This is what
 * lets the actual per-record {@link ISymetricCipher.encrypt}/`decrypt` stay
 * fully synchronous afterward: Web Crypto has no synchronous AES-GCM in
 * either browser or Node, but `node:crypto`'s `createCipheriv`/
 * `createDecipheriv` does, and resolving the module once per session (not
 * once per record) keeps `NetworkConnection.send`'s synchronous contract
 * intact with no ripple into the hot send/receive path. The tradeoff is that
 * encrypted transport is Node-only for now — a browser WSocket connection
 * can still connect, just not with `encryptionMode` set.
 */
export class AesEncryptionProvider implements IEncryptionProvider {
  static readonly Name = "aes-gcm";
  readonly defaultName = AesEncryptionProvider.Name;
  readonly maximumRecordOverhead = RECORD_OVERHEAD;

  async createCipher(context: EncryptionContext): Promise<ISymetricCipher> {
    const nodeCrypto = await getNodeCrypto();
    return new AesGcmSymetricCipher(context, nodeCrypto);
  }
}

/**
 * AES-256-GCM session record cipher (port of C# `AesGcmSymetricCipher`).
 *
 * A record contains an 8-byte big-endian sequence followed by ciphertext and
 * a 16-byte GCM tag. The transport's 4-byte record length and the sequence
 * are authenticated as associated data. Sequence numbers are both implicit
 * state and explicit record fields, so replay and reordering fail closed.
 */
export class AesGcmSymetricCipher implements ISymetricCipher {
  /** {@link import("../../../esiur-dotnet counterpart").SymetricEncryptionAlgorithmType.AES} */
  readonly identifier = 0;

  private readonly contextSalt: Uint8Array;
  private readonly sendKeyLabel: Uint8Array;
  private readonly receiveKeyLabel: Uint8Array;
  private readonly sendNonceLabel: Uint8Array;
  private readonly receiveNonceLabel: Uint8Array;

  private sendKey: Uint8Array | undefined;
  private receiveKey: Uint8Array | undefined;
  private sendNoncePrefix: Uint8Array | undefined;
  private receiveNoncePrefix: Uint8Array | undefined;
  private sendSequence = 0n;
  private receiveSequence = 0n;
  private keyInitialized = false;

  constructor(
    context: EncryptionContext,
    private readonly nodeCrypto: NodeCrypto,
  ) {
    validateContext(context);
    this.contextSalt = composeContextSalt(context, nodeCrypto);

    if (context.direction === AuthenticationDirection.Initiator) {
      this.sendKeyLabel = INITIATOR_TO_RESPONDER_KEY_LABEL;
      this.receiveKeyLabel = RESPONDER_TO_INITIATOR_KEY_LABEL;
      this.sendNonceLabel = INITIATOR_TO_RESPONDER_NONCE_LABEL;
      this.receiveNonceLabel = RESPONDER_TO_INITIATOR_NONCE_LABEL;
    } else {
      this.sendKeyLabel = RESPONDER_TO_INITIATOR_KEY_LABEL;
      this.receiveKeyLabel = INITIATOR_TO_RESPONDER_KEY_LABEL;
      this.sendNonceLabel = RESPONDER_TO_INITIATOR_NONCE_LABEL;
      this.receiveNonceLabel = INITIATOR_TO_RESPONDER_NONCE_LABEL;
    }

    this.setKey(context.key);
  }

  encrypt(data: Uint8Array): Uint8Array {
    if (!this.sendKey || !this.sendNoncePrefix) throw new Error("Cipher key is not initialized.");
    if (this.sendSequence === MAX_SEQUENCE)
      throw new Error("The AES-GCM send sequence is exhausted.");

    const sequence = this.sendSequence;
    const recordLength = data.length + RECORD_OVERHEAD;
    const nonce = composeNonce(this.sendNoncePrefix, sequence);
    const aad = composeAad(recordLength, sequence);

    const cipher = this.nodeCrypto.createCipheriv("aes-256-gcm", this.sendKey, nonce, {
      authTagLength: TAG_SIZE,
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();

    this.sendSequence++;
    return merge(uint64ToBytes(sequence, Endian.Big), ciphertext, tag);
  }

  decrypt(data: Uint8Array): Uint8Array {
    if (!this.receiveKey || !this.receiveNoncePrefix)
      throw new Error("Cipher key is not initialized.");
    if (data.length < RECORD_OVERHEAD) throw new Error("The AES-GCM record is truncated.");

    const sequence = readUInt64BE(data, 0);
    if (sequence !== this.receiveSequence)
      throw new Error("The AES-GCM record sequence is invalid.");
    if (this.receiveSequence === MAX_SEQUENCE)
      throw new Error("The AES-GCM receive sequence is exhausted.");

    const recordLength = data.length;
    const ciphertext = data.subarray(SEQUENCE_SIZE, data.length - TAG_SIZE);
    const tag = data.subarray(data.length - TAG_SIZE);
    const nonce = composeNonce(this.receiveNoncePrefix, sequence);
    const aad = composeAad(recordLength, sequence);

    const decipher = this.nodeCrypto.createDecipheriv("aes-256-gcm", this.receiveKey, nonce, {
      authTagLength: TAG_SIZE,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);

    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
      throw new Error("AES-GCM record authentication failed.", { cause: error });
    }

    this.receiveSequence++;
    return new Uint8Array(plaintext);
  }

  /**
   * Initialize the cipher key. Session ciphers are deliberately immutable
   * after construction — resetting a key would also reset the GCM nonce
   * sequence. Create a new cipher with fresh peer nonces to use different
   * key material.
   */
  setKey(key: Uint8Array): Uint8Array {
    validateSharedKey(key);
    if (this.keyInitialized)
      throw new Error(
        "AES-GCM session keys are immutable; create a new cipher with fresh peer nonces.",
      );

    this.sendKey = derive(this.nodeCrypto, key, this.contextSalt, this.sendKeyLabel, KEY_SIZE);
    this.receiveKey = derive(
      this.nodeCrypto,
      key,
      this.contextSalt,
      this.receiveKeyLabel,
      KEY_SIZE,
    );
    this.sendNoncePrefix = derive(
      this.nodeCrypto,
      key,
      this.contextSalt,
      this.sendNonceLabel,
      NONCE_PREFIX_SIZE,
    );
    this.receiveNoncePrefix = derive(
      this.nodeCrypto,
      key,
      this.contextSalt,
      this.receiveNonceLabel,
      NONCE_PREFIX_SIZE,
    );
    this.sendSequence = 0n;
    this.receiveSequence = 0n;
    this.keyInitialized = true;
    return key.slice();
  }
}

function validateSharedKey(key: Uint8Array): void {
  if (key.length < MIN_SHARED_KEY || key.length > MAX_SHARED_KEY)
    throw new RangeError(
      `The shared key must contain between ${MIN_SHARED_KEY} and ${MAX_SHARED_KEY} bytes.`,
    );
}

function validateNonce(nonce: Uint8Array | null | undefined, name: string): asserts nonce is Uint8Array {
  if (!nonce) throw new Error(`${name} is required.`);
  if (nonce.length < MIN_PEER_NONCE || nonce.length > MAX_PEER_NONCE)
    throw new RangeError(
      `${name} must contain between ${MIN_PEER_NONCE} and ${MAX_PEER_NONCE} bytes.`,
    );
}

function validateAddress(
  address: Uint8Array | null | undefined,
  name: string,
): asserts address is Uint8Array {
  if (!address) throw new Error(`${name} is required for address-bound encryption.`);
  if (address.length !== 4 && address.length !== 16)
    throw new RangeError(`${name} must be an IPv4 or IPv6 byte sequence.`);
}

function isUnspecifiedAddress(address: Uint8Array): boolean {
  return address.every((b) => b === 0);
}

function validateContext(context: EncryptionContext): void {
  validateSharedKey(context.key);
  validateNonce(context.initiatorNonce, "initiatorNonce");
  validateNonce(context.responderNonce, "responderNonce");

  if (
    context.direction !== AuthenticationDirection.Initiator &&
    context.direction !== AuthenticationDirection.Responder
  )
    throw new RangeError("Invalid encryption context direction.");
  if (context.mode === EncryptionMode.None)
    throw new Error("AES-GCM requires an encrypted session mode.");
  if (
    context.mode !== EncryptionMode.EncryptWithSessionKey &&
    context.mode !== EncryptionMode.EncryptWithSessionKeyAndAddress
  )
    throw new RangeError(`Unsupported encryption mode \`${context.mode}\`.`);
  if (!context.protocol?.trim()) throw new Error("A negotiated encryption protocol is required.");
  if (!context.offeredProtocols || context.offeredProtocols.length === 0)
    throw new Error("The initiator's encryption offer is required.");
  if (context.offeredProtocols.some((p) => !p?.trim()))
    throw new Error("Encryption offers cannot contain empty protocol names.");
  if (!context.offeredProtocols.includes(context.protocol))
    throw new Error("The selected encryption protocol was not offered.");
  if (context.authenticationMode === AuthenticationMode.None)
    throw new Error("AES-GCM requires an authenticated session.");
  if (!context.authenticationProtocol?.trim())
    throw new Error("A negotiated authentication protocol is required.");

  if (context.mode === EncryptionMode.EncryptWithSessionKeyAndAddress) {
    validateAddress(context.initiatorAddress, "initiatorAddress");
    validateAddress(context.responderAddress, "responderAddress");
    if (
      isUnspecifiedAddress(context.initiatorAddress) ||
      isUnspecifiedAddress(context.responderAddress)
    )
      throw new Error("Address-bound encryption requires concrete peer network addresses.");
  }
}

function lengthPrefixed(value: Uint8Array): Uint8Array {
  return merge(uint32ToBytes(value.length, Endian.Big), value);
}

/** SHA-256 over an ordered, length-prefixed transcript of every negotiation field. */
function composeContextSalt(context: EncryptionContext, nodeCrypto: NodeCrypto): Uint8Array {
  const parts: Uint8Array[] = [
    CONTEXT_LABEL,
    Uint8Array.of(context.authenticationMode & 0xff),
    lengthPrefixed(stringToBytes(context.authenticationProtocol)),
    lengthPrefixed(stringToBytes(context.domain ?? "")),
    Uint8Array.of(context.mode & 0xff),
    uint32ToBytes(context.offeredProtocols.length, Endian.Big),
  ];
  for (const offered of context.offeredProtocols) parts.push(lengthPrefixed(stringToBytes(offered)));
  parts.push(lengthPrefixed(stringToBytes(context.protocol)));
  parts.push(lengthPrefixed(context.initiatorNonce));
  parts.push(lengthPrefixed(context.responderNonce));

  if (context.mode === EncryptionMode.EncryptWithSessionKeyAndAddress) {
    parts.push(lengthPrefixed(context.initiatorAddress!));
    parts.push(lengthPrefixed(context.responderAddress!));
  }

  const transcript = merge(...parts);
  return new Uint8Array(nodeCrypto.createHash("sha256").update(transcript).digest());
}

function derive(
  nodeCrypto: NodeCrypto,
  key: Uint8Array,
  salt: Uint8Array,
  label: Uint8Array,
  size: number,
): Uint8Array {
  return new Uint8Array(nodeCrypto.hkdfSync("sha256", key, salt, label, size));
}

function composeNonce(prefix: Uint8Array, sequence: bigint): Uint8Array {
  return merge(prefix, uint64ToBytes(sequence, Endian.Big));
}

function composeAad(recordLength: number, sequence: bigint): Uint8Array {
  return merge(uint32ToBytes(recordLength, Endian.Big), uint64ToBytes(sequence, Endian.Big));
}

function readUInt64BE(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(data[offset + i]);
  return value;
}

async function getNodeCrypto(): Promise<NodeCrypto> {
  try {
    return await import("node:crypto");
  } catch (error) {
    throw new Error(
      "AesEncryptionProvider requires Node.js — the 'node:crypto' module is unavailable in this environment.",
      { cause: error },
    );
  }
}
