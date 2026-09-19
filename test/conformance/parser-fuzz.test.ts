import { describe, expect, it } from "vitest";
import { compose, parseAsync, parseSync } from "../../src/data/Codec.js";

/** Deterministic mutations keep this useful and reproducible in CI. */
describe("self-describing parser mutation fuzz", () => {
  it("terminates safely for truncated, bit-flipped, and random packets", async () => {
    const seeds = [
      compose(null),
      compose("Esiur 3.1 interoperability"),
      compose([1, "two", true, new Uint8Array([3, 4, 5])]),
      compose(new Map<unknown, unknown>([["key", [1, 2, 3]]])),
    ];
    const corpus: Uint8Array[] = [];

    for (const seed of seeds) {
      for (let length = 0; length <= seed.length; length++)
        corpus.push(seed.slice(0, length));
      for (let index = 0; index < seed.length; index++) {
        const changed = seed.slice();
        changed[index] ^= 1 << (index % 8);
        corpus.push(changed);
      }
    }

    let state = 0x31e5_1a7d;
    for (let sample = 0; sample < 512; sample++) {
      state = next(state);
      const bytes = new Uint8Array(state % 257);
      for (let index = 0; index < bytes.length; index++) {
        state = next(state);
        bytes[index] = state & 0xff;
      }
      corpus.push(bytes);
    }

    for (const bytes of corpus) await probe(bytes);
  }, 10_000);
});

async function probe(bytes: Uint8Array): Promise<void> {
  try {
    const parsed = parseSync(bytes, 0, null);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBeLessThanOrEqual(bytes.length);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
  }

  try {
    const parsed = await parseAsync(bytes, 0, null, undefined, null);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBeLessThanOrEqual(bytes.length);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
  }
}

function next(value: number): number {
  return (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
}
