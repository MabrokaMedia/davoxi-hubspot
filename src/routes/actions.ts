import { Router } from "express";
import { getTokens } from "../services/token-store";
import { DavoxiClient } from "@davoxi/client";
import { config } from "../config";

const router = Router();

/**
 * GET /actions/businesses — List Davoxi businesses for a HubSpot portal.
 */
router.get("/businesses", async (req, res) => {
  const portalId = req.query.portalId as string;
  if (!portalId) {
    res.status(400).json({ error: "portalId is required" });
    return;
  }

  const record = getTokens(portalId);
  if (!record?.davoxiApiKey) {
    res.status(404).json({ error: "Davoxi API key not configured" });
    return;
  }

  try {
    const client = new DavoxiClient({ apiKey: record.davoxiApiKey, apiUrl: config.davoxi.apiUrl });
    const businesses = await client.listBusinesses();
    res.json(businesses);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /actions/agents — List Davoxi agents for a business.
 */
router.get("/agents", async (req, res) => {
  const portalId = req.query.portalId as string;
  const businessId = req.query.businessId as string;

  if (!portalId || !businessId) {
    res.status(400).json({ error: "portalId and businessId are required" });
    return;
  }

  const record = getTokens(portalId);
  if (!record?.davoxiApiKey) {
    res.status(404).json({ error: "Davoxi API key not configured" });
    return;
  }

  try {
    const client = new DavoxiClient({ apiKey: record.davoxiApiKey, apiUrl: config.davoxi.apiUrl });
    const agents = await client.listAgents(businessId);
    res.json(agents);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /actions/usage — Get Davoxi usage summary.
 */
router.get("/usage", async (req, res) => {
  const portalId = req.query.portalId as string;
  if (!portalId) {
    res.status(400).json({ error: "portalId is required" });
    return;
  }

  const record = getTokens(portalId);
  if (!record?.davoxiApiKey) {
    res.status(404).json({ error: "Davoxi API key not configured" });
    return;
  }

  try {
    const client = new DavoxiClient({ apiKey: record.davoxiApiKey, apiUrl: config.davoxi.apiUrl });
    const usage = await client.getUsageSummary();
    res.json(usage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
