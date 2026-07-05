import { AsyncReply } from "../../core/AsyncReply.js";
import type { AuthenticationContext } from "../AuthenticationContext.js";
import type { AuthenticationSession } from "../AuthenticationSession.js";
import type { IAuthenticationHandler } from "../IAuthenticationHandler.js";
import type { IAuthenticationProvider } from "../IAuthenticationProvider.js";
import { IdentityPassword } from "./IdentityPassword.js";
import { PasswordAuthenticationHandler } from "./PasswordAuthenticationHandler.js";
import { PasswordHash } from "./PasswordHash.js";

/** Base provider for Esiur's SHA3 password-hash authentication protocol. */
export class PasswordAuthenticationProvider implements IAuthenticationProvider {
  readonly defaultName = "hash";

  createAuthenticationHandler(context: AuthenticationContext): IAuthenticationHandler {
    return new PasswordAuthenticationHandler(
      context.mode,
      context.direction,
      context.initiatorIdentity ?? null,
      context.responderIdentity ?? null,
      context.hostName ?? null,
      context.domain ?? null,
      this,
    );
  }

  getHostedAccountCredential(_identity: string, _domain: string | null): PasswordHash {
    return new PasswordHash();
  }

  getSelfIdentityAndCredential(_domain: string | null, _hostname: string | null): IdentityPassword {
    return new IdentityPassword();
  }

  getSelfCredential(
    _identity: string,
    _domain: string | null,
    _hostname: string | null,
  ): Uint8Array | null {
    return null;
  }

  login(_session: AuthenticationSession): AsyncReply<boolean> {
    return AsyncReply.fromResult(false);
  }

  logout(_session: AuthenticationSession): AsyncReply<boolean> {
    return AsyncReply.fromResult(false);
  }
}
