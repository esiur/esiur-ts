import { combine } from "../data/DC.js";

/**
 * Accumulating receive buffer (port of C# `NetworkBuffer`). The protocol parser
 * drains it with {@link read}; when a partial unit remains, it calls
 * {@link protect}/{@link holdFor} to push the unparsed tail back so it is
 * prepended to the next {@link write}. {@link protected_} is true while waiting
 * for more bytes.
 */
export class NetworkBuffer {
  private data: Uint8Array = new Uint8Array(0);
  private neededDataLength = 0;

  /** True while more bytes are required before the held data can be read. */
  get protected_(): boolean {
    return this.neededDataLength > this.data.length;
  }

  /** Number of buffered bytes. */
  get available(): number {
    return this.data.length;
  }

  /** Hold the next write, expecting at least `src.length + 1` bytes total. */
  holdForNextWrite(src: Uint8Array): void {
    this.holdFor(src, 0, src.length, src.length + 1);
  }

  /** Prepend `src[offset..offset+size]` to the buffer and wait for `needed` bytes. */
  holdFor(src: Uint8Array, offset: number, size: number, needed: number): void {
    if (size >= needed) throw new Error("Size >= Needed!");
    this.data = combine(src, offset, size, this.data, 0, this.data.length);
    this.neededDataLength = needed;
  }

  /**
   * If `src` from `offset` has fewer than `needed` bytes, hold the remainder and
   * return true (caller should stop and wait); otherwise return false.
   */
  protect(src: Uint8Array, offset: number, needed: number): boolean {
    const dataLength = src.length - offset;
    if (dataLength < needed) {
      this.holdFor(src, offset, dataLength, needed);
      return true;
    }
    return false;
  }

  /** Append bytes to the buffer. */
  write(src: Uint8Array, offset = 0, length = src.length - offset): void {
    const out = new Uint8Array(this.data.length + length);
    out.set(this.data, 0);
    out.set(src.subarray(offset, offset + length), this.data.length);
    this.data = out;
  }

  /** True if a full held unit (or any data, when not holding) is available. */
  get canRead(): boolean {
    return this.data.length > 0 && this.data.length >= this.neededDataLength;
  }

  /** Take all buffered bytes if available (respecting any hold), else null. */
  read(): Uint8Array | null {
    if (this.data.length === 0) return null;

    if (this.neededDataLength === 0) {
      const rt = this.data;
      this.data = new Uint8Array(0);
      return rt;
    }

    if (this.data.length >= this.neededDataLength) {
      const rt = this.data;
      this.data = new Uint8Array(0);
      this.neededDataLength = 0;
      return rt;
    }

    return null;
  }
}
