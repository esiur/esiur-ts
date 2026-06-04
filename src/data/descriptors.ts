import { Tru, TruPrimitive, TruComposite } from "./Tru.js";
import { TruIdentifier } from "./TruIdentifier.js";

/**
 * Type descriptors — the TypeScript stand-in for C#'s reflection-driven
 * `Tru.FromType`. Use these to declare element/key/value types where the wire
 * needs a type representation (typed lists/maps/tuples), e.g.
 * `t.list(t.i32)` or `t.map(t.string, t.f64)`. The codegen CLI emits these.
 */
function tupleIdentifier(count: number): TruIdentifier {
  switch (count) {
    case 2: return TruIdentifier.Tuple2;
    case 3: return TruIdentifier.Tuple3;
    case 4: return TruIdentifier.Tuple4;
    case 5: return TruIdentifier.Tuple5;
    case 6: return TruIdentifier.Tuple6;
    case 7: return TruIdentifier.Tuple7;
    default:
      throw new RangeError("Tuples must have between 2 and 7 elements.");
  }
}

export const t = {
  void: new TruPrimitive(TruIdentifier.Void),
  dynamic: new TruPrimitive(TruIdentifier.Dynamic),
  bool: new TruPrimitive(TruIdentifier.Bool),
  char: new TruPrimitive(TruIdentifier.Char),
  u8: new TruPrimitive(TruIdentifier.UInt8),
  i8: new TruPrimitive(TruIdentifier.Int8),
  u16: new TruPrimitive(TruIdentifier.UInt16),
  i16: new TruPrimitive(TruIdentifier.Int16),
  u32: new TruPrimitive(TruIdentifier.UInt32),
  i32: new TruPrimitive(TruIdentifier.Int32),
  u64: new TruPrimitive(TruIdentifier.UInt64),
  i64: new TruPrimitive(TruIdentifier.Int64),
  u128: new TruPrimitive(TruIdentifier.UInt128),
  i128: new TruPrimitive(TruIdentifier.Int128),
  f32: new TruPrimitive(TruIdentifier.Float32),
  f64: new TruPrimitive(TruIdentifier.Float64),
  decimal: new TruPrimitive(TruIdentifier.Decimal),
  string: new TruPrimitive(TruIdentifier.String),
  rawData: new TruPrimitive(TruIdentifier.RawData),
  datetime: new TruPrimitive(TruIdentifier.DateTime),
  resource: new TruPrimitive(TruIdentifier.Resource),
  record: new TruPrimitive(TruIdentifier.Record),

  list: (element: Tru): TruComposite =>
    new TruComposite(TruIdentifier.TypedList, false, [element]),
  map: (key: Tru, value: Tru): TruComposite =>
    new TruComposite(TruIdentifier.TypedMap, false, [key, value]),
  tuple: (...subTypes: Tru[]): TruComposite =>
    new TruComposite(tupleIdentifier(subTypes.length), false, subTypes),
  nullable: (type: Tru): Tru => type.toNullable(),
} as const;

/**
 * An explicitly-typed array value. Composing it produces a Typed TDU whose
 * metadata is `TypedList<element>`; numeric element types use the compact Gvwie
 * group encoding.
 */
export class TypedList {
  constructor(
    readonly element: Tru,
    readonly values: readonly unknown[],
  ) {}
}

/** Construct a {@link TypedList} value, e.g. `typedList(t.i32, [1, 2, 3])`. */
export function typedList(element: Tru, values: readonly unknown[]): TypedList {
  return new TypedList(element, values);
}
