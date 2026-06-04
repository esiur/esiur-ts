/** Category of an {@link AsyncException}. Wire-significant: sent in error replies. */
export enum ErrorType {
  Management = 0,
  Exception = 1,
  Warning = 2,
}
