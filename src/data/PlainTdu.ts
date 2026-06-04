import { TduClass } from "./TduClass.js";
import { TduIdentifier } from "./TduIdentifier.js";

/**
 * A measured-but-undecoded TDU (port of C# `PlainTdu`). Used by the packet layer
 * to delimit a value within a packet without decoding it — the decode (which may
 * need the connection to resolve remote resources/typedefs) is deferred and run
 * later via the async {@link Codec} parse path. Unlike {@link ParsedTdu}, the
 * Typed branch does not parse its Tru metadata; `payloadLength` covers the whole
 * content (metadata + value).
 */
export class PlainTdu {
  identifier: TduIdentifier = TduIdentifier.Null;
  index = 0;
  tduClass: TduClass = TduClass.Invalid;
  /** Offset of the TDU start (the identifier byte). */
  tduOffset = 0;
  payloadOffset = 0;
  payloadLength = 0;
  exponent = 0;
  totalLength = 0;
  data: Uint8Array = new Uint8Array(0);
  ends = 0;

  static invalid(totalLength: number): PlainTdu {
    const t = new PlainTdu();
    t.tduClass = TduClass.Invalid;
    t.totalLength = totalLength;
    return t;
  }

  /** Measure the TDU at `offset` without decoding its value. */
  static parse(data: Uint8Array, offset: number, ends: number): PlainTdu {
    const start = offset;
    const h = data[offset++];
    const cls = (h >> 6) as TduClass;

    if (cls === TduClass.Fixed) {
      const exp = (h & 0x38) >> 3;
      const t = new PlainTdu();
      t.data = data;
      t.tduClass = cls;
      t.identifier = h as TduIdentifier;
      t.exponent = exp;
      t.index = h & 0x7;
      t.tduOffset = start;
      t.ends = ends;

      if (exp === 0) {
        t.payloadOffset = offset;
        t.payloadLength = 0;
        t.totalLength = 1;
        return t;
      }

      const cl = 1 << (exp - 1);
      if (ends - offset < cl) return PlainTdu.invalid(cl - (ends - offset));

      t.payloadOffset = offset;
      t.payloadLength = cl;
      t.totalLength = 1 + cl;
      return t;
    }

    // Dynamic / Typed / Extension: read `cll` big-endian length bytes.
    const cll = (h >> 3) & 0x7;
    if (ends - offset < cll) return PlainTdu.invalid(cll - (ends - offset));

    let cl = 0;
    for (let i = 0; i < cll; i++) cl = cl * 256 + data[offset++];
    if (ends - offset < cl) return PlainTdu.invalid(cl - (ends - offset));

    const t = new PlainTdu();
    t.data = data;
    t.tduClass = cls;
    t.identifier = (h & 0xc7) as TduIdentifier;
    t.index = h & 0x7;
    t.tduOffset = start;
    t.payloadOffset = offset;
    t.payloadLength = cl;
    t.totalLength = 1 + cl + cll;
    t.ends = ends;
    return t;
  }
}
