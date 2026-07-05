import type { AsyncReply } from "../core/AsyncReply.js";
import type { AuthenticationContext } from "./AuthenticationContext.js";
import type { AuthenticationSession } from "./AuthenticationSession.js";
import type { IAuthenticationHandler } from "./IAuthenticationHandler.js";

export type AuthenticationProviderReply = boolean | PromiseLike<boolean> | AsyncReply<boolean>;

/** Factory and lifecycle hooks for an authentication protocol. */
export interface IAuthenticationProvider {
  readonly defaultName: string;
  createAuthenticationHandler(context: AuthenticationContext): IAuthenticationHandler | null;
  login?(session: AuthenticationSession): AuthenticationProviderReply;
  logout?(session: AuthenticationSession): AuthenticationProviderReply;
}
