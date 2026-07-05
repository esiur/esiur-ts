import type { AuthenticationResult } from "./AuthenticationResult.js";
import type { IAuthenticationProvider } from "./IAuthenticationProvider.js";

/** Per-connection authentication state machine. */
export interface IAuthenticationHandler {
  readonly provider: IAuthenticationProvider;
  readonly protocol: string;
  process(authData: unknown): AuthenticationResult;
}
