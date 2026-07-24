/**
 * Raised when untrusted input declares a length that exceeds a configured
 * parser budget (port of C# `ParserLimitException`).
 */
export class ParserLimitException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParserLimitException";
    Object.setPrototypeOf(this, ParserLimitException.prototype);
  }
}

/**
 * Default cap on a TDU's declared payload length, matching esiur-dotnet's
 * `ParserConfiguration.MaximumPacketSize` default (8 MiB). The Dynamic/Typed/
 * Extension length prefix can be up to 7 bytes (declaring up to 2^56), so
 * leaving it unchecked lets a peer force a huge allocation — or a long wait
 * for bytes that may never arrive — from a single header.
 */
export const DEFAULT_MAXIMUM_PAYLOAD_LENGTH = 8 * 1024 * 1024;

/**
 * Throws {@link ParserLimitException} when `declaredLength` exceeds
 * `maximumPayloadLength` (port of C# `ParserGuard.EnsurePacketSize`). Callers
 * must invoke this immediately after decoding the length prefix, before it is
 * used to size an allocation or decide how many more bytes to wait for. A
 * `maximumPayloadLength` of `0` disables the check.
 */
export function ensurePacketSize(declaredLength: number, maximumPayloadLength: number): void {
  if (maximumPayloadLength > 0 && declaredLength > maximumPayloadLength)
    throw new ParserLimitException(
      `Declared packet payload of ${declaredLength} bytes exceeds the ${maximumPayloadLength}-byte limit.`,
    );
}
