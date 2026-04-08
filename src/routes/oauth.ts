import { Router } from "express";
import crypto from "crypto";
import { config } from "../config";
import { exchangeCodeForTokens, getPortalId } from "../services/hubspot-client";
import { saveTokens } from "../services/token-store";

const router = Router();

// In-memory state store with 5-minute expiry (CSRF protection)
interface StateEntry {
  expiresAt: number;
}
const pendingStates = new Map<string, StateEntry>();

const STATE_TTL_MS = 5 * 60 * 1000;

export function generateState(): string {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { expiresAt: Date.now() + STATE_TTL_MS });
  return state;
}

export function validateState(state: string): boolean {
  const entry = pendingStates.get(state);
  if (!entry) return false;
  pendingStates.delete(state);
  if (Date.now() > entry.expiresAt) return false;
  return true;
}

/**
 * GET /oauth/authorize — Redirect user to HubSpot OAuth consent screen.
 */
router.get("/authorize", (_req, res) => {
  const state = generateState();
  const params = new URLSearchParams({
    client_id: config.hubspot.clientId,
    redirect_uri: `${config.appUrl}/oauth/callback`,
    scope: config.hubspot.scopes.join(" "),
    state,
  });
  res.redirect(`${config.hubspot.oauthUrl}?${params}`);
});

/**
 * GET /oauth/callback — Handle HubSpot OAuth callback.
 */
router.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  const state = req.query.state as string | undefined;
  if (!state || !validateState(state)) {
    res.status(400).json({ error: "Invalid or missing state parameter" });
    return;
  }

  try {
    const tokenData = await exchangeCodeForTokens(code);
    const portalId = await getPortalId(tokenData.access_token);

    saveTokens({
      portalId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    });

    res.json({
      success: true,
      portalId,
      message: "Davoxi connected to HubSpot. Configure your Davoxi API key at /settings.",
    });
  } catch (err) {
    console.error("OAuth token exchange failed:", err);
    res.status(500).json({ error: "OAuth token exchange failed" });
  }
});

export default router;
