import { TduClass } from "./TduClass.js";
import { TduIdentifier } from "./TduIdentifier.js";
import { merge } from "./DC.js";

/** Type-representation metadata that can serialize itself (implemented by Tru). */
export interface ComposableTru {
  compose(connection: unknown): Uint8Array;
  match(other: ComposableTru): boolean;
}

/**
 * Build the framing header for a length-prefixed (Dynamic/Typed/Extension) TDU:
 * `[identifier | (n << 3)]` followed by the content length as `n` big-endian
 * bytes. A zero-length payload omits the size flag and length bytes entirely.
 */
function framedHeader(idByte: number, contentLength: number): Uint8Array {
  if (contentLength === 0) return Uint8Array.of(idByte);

  let n: number;
  if (contentLength <= 0xff) n = 1;
  else if (contentLength <= 0xffff) n = 2;
  else if (contentLength <= 0xffffff) n = 3;
  else if (contentLength <= 0xffffffff) n = 4;
  else if (contentLength <= 0xffffffffff) n = 5;
  else if (contentLength <= 0xffffffffffff) n = 6;
  else n = 7;

  const header = new Uint8Array(1 + n);
  header[0] = (idByte | (n << 3)) & 0xff;
  for (let i = 0; i < n; i++)
    header[1 + i] = Math.floor(contentLength / 2 ** (8 * (n - 1 - i))) % 256;
  return header;
}

/**
 * A Transmission Data Unit — one self-describing value on the wire
 * (port of C# `Tdu`). The constructor produces {@link composed}, the full
 * encoded bytes including the leading identifier.
 */
export class Tdu {
  readonly identifier: TduIdentifier;
  readonly tduClass: TduClass;
  /** Fully encoded bytes (identifier + framing + payload). */
  readonly composed: Uint8Array;
  /** Offset within {@link composed} at which the value payload begins. */
  readonly contentOffset: number = 0;
  /** Type metadata for {@link TduClass.Typed} units. */
  readonly metadata: ComposableTru | null;

  constructor(
    identifier: TduIdentifier,
    data: Uint8Array | null,
    length: number,
    metadata: ComposableTru | null = null,
    connection: unknown = null,
  ) {
    this.identifier = identifier;
    this.tduClass = (identifier >> 6) as TduClass;
    this.metadata = metadata;

    const idByte = identifier & 0xff;

    if (this.tduClass === TduClass.Fixed) {
      if (length === 0) {
        this.composed = Uint8Array.of(idByte);
      } else {
        const out = new Uint8Array(1 + length);
        out[0] = idByte;
        out.set(data!.subarray(0, length), 1);
        this.composed = out;
      }
    } else if (
      this.tduClass === TduClass.Dynamic ||
      this.tduClass === TduClass.Extension ||
      (this.tduClass === TduClass.Typed && this.identifier !== TduIdentifier.Typed)
    ) {
      // Dynamic/Extension, and Typed-but-not-plain-Typed (TypeDef/TRU): a
      // plain framed payload with no metadata prefix.
      const header = framedHeader(idByte, length);
      if (length === 0) {
        this.composed = header;
      } else {
        this.composed = merge(header, data!.subarray(0, length));
        this.contentOffset = header.length;
      }
    } else {
      // Typed identifier itself (0x80): metadata bytes precede the payload.
      if (metadata == null)
        throw new Error("Metadata must be provided for typed TDUs.");
      const metadataData = metadata.compose(connection);
      const content = merge(metadataData, (data ?? new Uint8Array(0)).subarray(0, length));
      const header = framedHeader(idByte, content.length);
      this.composed = merge(header, content);
      this.contentOffset = header.length + metadataData.length;
    }
  }

  /** True if both are typed TDUs of the same identifier and matching metadata. */
  matchType(other: Tdu): boolean {
    if (this.identifier !== other.identifier) return false;
    if (this.tduClass !== TduClass.Typed || other.tduClass !== TduClass.Typed)
      return false;
    // TypeDef/TRU carry no metadata — the identifier alone fully describes
    // the outer type, so two TDUs with the same identifier already match.
    if (this.identifier !== TduIdentifier.Typed) return true;
    if (this.metadata == null || other.metadata == null) return false;
    return this.metadata.match(other.metadata);
  }
}
