import "../internal/metadata.js";

/** A discovered `@Index`ed member: its wire index and property name. */
export interface IndexedMember {
  index: number;
  name: string;
}

const INDEXED_MEMBERS = Symbol.for("esiur.indexedMembers");

type MetaBag = Record<symbol, unknown>;

/**
 * Marks a class field as a wire member of an {@link IndexedStructure}, keyed
 * by a stable byte index 0-255 (port of C#'s `[Index(n)]`). Plain class
 * fields are enough here — unlike `@Export`, indexed members need no
 * change-notification wrapping, just presence in `context.metadata`.
 *
 * Subclassing inherits base-class `@Index` fields automatically: the TC39
 * decorator-metadata proposal chains `[Symbol.metadata]` through the
 * prototype, so e.g. `PropertyDefInfo extends MemberDefInfo` sees
 * `MemberDefInfo`'s indexed fields with no extra work.
 */
export function Index(index: number) {
  if (index < 0 || index > 255)
    throw new RangeError("A structure index must be between 0 and 255.");
  return function (_value: unknown, context: ClassMemberDecoratorContext): void {
    if (context.kind !== "field" && context.kind !== "accessor")
      throw new Error(`@Index cannot be applied to a ${context.kind} ('${String(context.name)}').`);
    const meta = context.metadata as MetaBag;
    const members = ownMembers(meta);
    const name = String(context.name);
    if (members.some((m) => m.index === index))
      throw new Error(`Structure index ${index} is already used on this type.`);
    members.push({ index, name });
  };
}

/**
 * Get (creating if absent) `meta`'s OWN `INDEXED_MEMBERS` array. `meta[KEY]`
 * alone isn't enough to detect absence: the TC39 metadata proposal chains a
 * subclass's `[Symbol.metadata]` object off its base class's via the
 * prototype, so a plain `??=` would read the *inherited* array through that
 * chain and then mutate it in place — silently corrupting the base class's
 * own member list with every subclass's fields. Seed a fresh own array (a
 * copy of whatever was inherited) the first time a subclass is decorated.
 */
function ownMembers(meta: MetaBag): IndexedMember[] {
  if (!Object.hasOwn(meta, INDEXED_MEMBERS)) {
    const inherited = (meta[INDEXED_MEMBERS] as IndexedMember[] | undefined) ?? [];
    meta[INDEXED_MEMBERS] = inherited.slice();
  }
  return meta[INDEXED_MEMBERS] as IndexedMember[];
}

/** Read the `@Index`ed members declared (including inherited) on `ctor`. */
export function getIndexedMembers(ctor: Function): IndexedMember[] {
  const meta = (ctor as { [Symbol.metadata]?: MetaBag })[Symbol.metadata];
  if (!meta) return [];
  return (meta[INDEXED_MEMBERS] as IndexedMember[] | undefined) ?? [];
}
