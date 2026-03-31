import { Router } from "express";
import { config } from "../config";
import { exchangeCodeForTokens, getPortalId } from "../services/hubspot-client";
import { saveTokens } from "../services/token-store";

const router = Router();

/**
 * GET /oauth/authorize — Redirect user to HubSpot OAuth consent screen.
 */
router.get("/authorize", (_req, res) => {
  const params = new URLSearchParams({
    client_id: config.hubspot.clientId,
    redirect_uri: `${config.appUrl}/oauth/callback`,
    scope: config.hubspot.scopes.join(" "),
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
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "OAuth token exchange failed", details: message });
  }
});

export default router;
