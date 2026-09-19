import { Uuid } from "../data/Uuid.js";

const EMPTY_GENERATION = new Uint8Array(16);

/** Exact position in a resource's ordered property/event change stream. */
export class ResourceCursor {
  constructor(
    readonly generation: Uuid,
    readonly revision: bigint,
  ) {
    if (revision < 0n || revision > 0xffff_ffff_ffff_ffffn)
      throw new RangeError("Resource cursor revision must fit UInt64.");
  }

  static empty(): ResourceCursor {
    return new ResourceCursor(new Uuid(EMPTY_GENERATION), 0n);
  }

  static create(revision = 0n): ResourceCursor {
    return new ResourceCursor(Uuid.newUuid(), revision);
  }

  get isEmpty(): boolean {
    return this.revision === 0n && this.generation.data.every((value) => value === 0);
  }

  equals(other: unknown): boolean {
    return (
      other instanceof ResourceCursor &&
      this.revision === other.revision &&
      this.generation.equals(other.generation)
    );
  }

  toString(): string {
    return `${this.generation.toString().replaceAll("-", "")}:${this.revision}`;
  }
}
