import { Ruling } from "../permissions/Ruling.js";

/**
 * Aggregated decisions from each independent manager category (port of C#
 * `ResourceManagerEvaluation`). An allow in one category never grants
 * admission in another category.
 */
export class ResourceManagerEvaluation {
  readonly delay: number;

  constructor(
    readonly permissions: Ruling,
    readonly rateControl: Ruling,
    readonly auditing: Ruling,
    delay: number,
    readonly permissionsDenialReason?: string,
    readonly rateControlDenialReason?: string,
    readonly auditingDenialReason?: string,
  ) {
    this.delay = delay > 0 ? delay : 0;
  }

  get isAllowed(): boolean {
    return (
      this.permissions === Ruling.Allowed &&
      this.rateControl !== Ruling.Denied &&
      this.auditing !== Ruling.Denied
    );
  }
}
