import fetch from "node-fetch";
import { config } from "../config";
import { getTokens, saveTokens } from "./token-store";

/**
 * Exchange authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(code: string) {
  const res = await fetch(config.hubspot.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.hubspot.clientId,
      client_secret: config.hubspot.clientSecret,
      redirect_uri: `${config.appUrl}/oauth/callback`,
      code,
    }),
  });

  if (!res.ok) {
    await res.text(); // consume body
    throw new Error(`HubSpot token exchange failed (${res.status})`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
}

/**
 * Refresh an expired access token.
 */
export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(config.hubspot.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.hubspot.clientId,
      client_secret: config.hubspot.clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    await res.text(); // consume body
    throw new Error(`HubSpot token refresh failed (${res.status})`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
}

/**
 * Get the portal ID for an access token.
 */
export async function getPortalId(accessToken: string): Promise<string> {
  const res = await fetch(`${config.hubspot.tokenUrl}/${accessToken}`, {
    method: "GET",
  });

  if (!res.ok) {
    throw new Error("Failed to get token info from HubSpot");
  }

  const data = (await res.json()) as { hub_id: number };
  return String(data.hub_id);
}

/**
 * Get a valid access token for a portal, refreshing if expired.
 */
export async function getValidToken(portalId: string): Promise<string> {
  const record = getTokens(portalId);
  if (!record) {
    throw new Error(`No tokens found for portal ${portalId}`);
  }

  if (Date.now() < record.expiresAt - 60_000) {
    return record.accessToken;
  }

  const refreshed = await refreshAccessToken(record.refreshToken);
  saveTokens({
    portalId,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    davoxiApiKey: record.davoxiApiKey,
  });

  return refreshed.access_token;
}

/**
 * Make an authenticated HubSpot API request.
 */
export async function hubspotRequest<T>(
  portalId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getValidToken(portalId);
  const url = `${config.hubspot.apiDomain}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API error (${res.status}): ${text}`);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  return JSON.parse(text) as T;
}
