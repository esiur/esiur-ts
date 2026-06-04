/**
 * Sentinel meaning "value unchanged" (port of C# `NotModified`). Used in
 * property-update replies to signal that a property keeps its current value.
 */
export class NotModified {
  static readonly Default = new NotModified();
  private constructor() {}
}
