import type { AuthenticationMaterial } from "./AuthenticationMaterial.js";
import type { AuthenticationDirection } from "./AuthenticationDirection.js";
import type { AuthenticationMode } from "./AuthenticationMode.js";

/** Context used by an authentication provider to create a per-connection handler. */
export interface AuthenticationContext {
  direction: AuthenticationDirection;
  mode: AuthenticationMode;
  domain?: string | null;
  initiatorIdentity?: string | null;
  responderIdentity?: string | null;
  materials?: AuthenticationMaterial[];
  hostName?: string | null;
}
