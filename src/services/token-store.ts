/**
 * In-memory token store. Replace with a database in production.
 */

export interface TokenRecord {
  portalId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  davoxiApiKey?: string;
}

const tokens = new Map<string, TokenRecord>();

export function saveTokens(record: TokenRecord): void {
  tokens.set(record.portalId, record);
}

export function getTokens(portalId: string): TokenRecord | undefined {
  return tokens.get(portalId);
}

export function deleteTokens(portalId: string): void {
  tokens.delete(portalId);
}

export function setDavoxiApiKey(portalId: string, apiKey: string): void {
  const record = tokens.get(portalId);
  if (record) {
    record.davoxiApiKey = apiKey;
    tokens.set(portalId, record);
  }
}
