/** Default native EP port used when an Esiur endpoint omits its port. */
export const ESIUR_DEFAULT_PORT = 51018;

/**
 * Validate an Esiur endpoint and add {@link ESIUR_DEFAULT_PORT} when its
 * authority does not contain a port. Explicit ports, including WebSocket
 * standard ports such as 80 and 443, are preserved verbatim.
 */
export function normalizeEsiurEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid EP endpoint: ${value}`);
  }

  if (!url.hostname) throw new Error(`Invalid EP endpoint: ${value}`);

  const portText = explicitPortText(value);
  if (portText !== undefined) {
    const port = Number(portText);
    if (!/^\d+$/.test(portText) || port <= 0 || port > 65535)
      throw new Error(`EP endpoint ports must be from 1 through 65535: ${value}`);
    return value;
  }

  url.port = String(ESIUR_DEFAULT_PORT);
  return url.toString();
}

function explicitPortText(value: string): string | undefined {
  const schemeEnd = value.indexOf("://");
  if (schemeEnd < 0) return undefined;

  const authorityStart = schemeEnd + 3;
  const separatorIndexes = ["/", "?", "#"]
    .map((separator) => value.indexOf(separator, authorityStart))
    .filter((index) => index >= 0);
  const authorityEnd = separatorIndexes.length > 0 ? Math.min(...separatorIndexes) : value.length;
  const authority = value.slice(authorityStart, authorityEnd).split("@").at(-1) ?? "";

  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket < 0 || authority[closingBracket + 1] !== ":") return undefined;
    return authority.slice(closingBracket + 2);
  }

  const colon = authority.lastIndexOf(":");
  return colon > 0 ? authority.slice(colon + 1) : undefined;
}
