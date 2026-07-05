import type { AuthenticationMaterialType } from "./AuthenticationMaterialType.js";

/** Extra material passed to an authentication provider when creating a handler. */
export interface AuthenticationMaterial {
  type: AuthenticationMaterialType;
  value: unknown;
}
