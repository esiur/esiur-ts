import { AsyncReply } from "../../core/AsyncReply.js";
import { merge } from "../../data/DC.js";
import type { AuthenticationContext } from "../AuthenticationContext.js";
import type { AuthenticationSession } from "../AuthenticationSession.js";
import type { IAuthenticationHandler } from "../IAuthenticationHandler.js";
import type { IAuthenticationProvider } from "../IAuthenticationProvider.js";
import { randomBytes } from "../random.js";
import { IdentityPassword } from "./IdentityPassword.js";
import { PasswordAuthenticationHandler } from "./PasswordAuthenticationHandler.js";
import { PasswordHash } from "./PasswordHash.js";

/** Base provider for Esiur's SHA3 password-hash authentication protocol. */
export class PasswordAuthenticationProvider implements IAuthenticationProvider {
  readonly defaultName = "password-sha3-v1";

  /** Derive a storable, salted {@link PasswordHash} from a plaintext password. */
  static createCredential(password: Uint8Array): PasswordHash {
    if (password.length === 0) throw new Error("A password cannot be empty.");
    const salt = randomBytes(32);
    const hash = PasswordAuthenticationHandler.computeSha3(merge(password, salt));
    return new PasswordHash(hash, salt);
  }

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
