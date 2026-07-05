/** Result state returned by an authentication handler step. */
export enum AuthenticationRuling {
  Failed = 0,
  InProgress = 1,
  Succeeded = 2,
}
