import type { ExceptionCode } from "../core/ExceptionCode.js";
import type { AuthenticationRuling } from "./AuthenticationRuling.js";

/** Result returned by one authentication handler step. */
export class AuthenticationResult {
  constructor(
    readonly ruling: AuthenticationRuling,
    readonly authenticationData: unknown,
    readonly localIdentity: string | null = null,
    readonly remoteIdentity: string | null = null,
    readonly sessionKey: Uint8Array | null = null,
    readonly exceptionCode: ExceptionCode | null = null,
    readonly exceptionMessage: string | null = null,
  ) {}
}
