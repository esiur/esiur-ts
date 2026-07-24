/** Delivery ordering guarantee for a property/event (port of C# `OrderingControl`). Not a flags enum. */
export enum OrderingControl {
  Strict = 0,
  Relaxed = 1,
  LatestOnly = 2,
}
