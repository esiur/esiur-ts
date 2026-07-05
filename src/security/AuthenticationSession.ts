import type { EpAuthPacketHeader } from "../net/packets/EpAuthPacketHeader.js";
import type { AuthenticationMode } from "./AuthenticationMode.js";

/** Authenticated session metadata exposed to provider login/logout hooks. */
export interface AuthenticationSession {
  authenticationMode: AuthenticationMode;
  localHeaders: Map<EpAuthPacketHeader, unknown>;
  remoteHeaders: Map<EpAuthPacketHeader, unknown>;
  localIdentity: string | null;
  remoteIdentity: string | null;
  key: Uint8Array | null;
  authenticated: boolean;
  variables: Map<string, unknown>;
}
