import { Router } from "express";
import { getTokens, setDavoxiApiKey } from "../services/token-store";
import { davoxiRequest } from "../services/davoxi-client";

const router = Router();

/**
 * POST /settings/api-key — Save the user's Davoxi API key for a portal.
 */
router.post("/api-key", async (req, res) => {
  const { portalId, apiKey } = req.body as { portalId?: string; apiKey?: string };

  if (!portalId || !apiKey) {
    res.status(400).json({ error: "portalId and apiKey are required" });
    return;
  }

  const record = getTokens(portalId);
  if (!record) {
    res.status(404).json({ error: "Portal not connected. Complete OAuth first." });
    return;
  }

  try {
    await davoxiRequest(apiKey, "GET", "/users/me");
  } catch {
    res.status(401).json({ error: "Invalid Davoxi API key" });
    return;
  }

  setDavoxiApiKey(portalId, apiKey);
  res.json({ success: true, message: "Davoxi API key saved" });
});

export default router;
