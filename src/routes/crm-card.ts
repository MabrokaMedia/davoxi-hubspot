import { Router } from "express";
import { getTokens } from "../services/token-store";
import { DavoxiClient } from "@davoxi/client";
import type { UsageSummary, Business } from "@davoxi/client";
import { config } from "../config";

const router = Router();

/**
 * GET /crm-card/contact — CRM card data for a HubSpot contact record.
 *
 * Shows Davoxi usage summary and linked businesses.
 * HubSpot calls this endpoint when rendering the CRM card sidebar.
 */
router.get("/contact", async (req, res) => {
  const portalId = req.query.portalId as string;

  if (!portalId) {
    res.json({ results: [] });
    return;
  }

  const record = getTokens(portalId);
  if (!record?.davoxiApiKey) {
    res.json({
      results: [],
      primaryAction: {
        type: "IFRAME",
        width: 400,
        height: 300,
        uri: `${req.protocol}://${req.get("host")}/settings`,
        label: "Configure Davoxi",
      },
    });
    return;
  }

  try {
    const client = new DavoxiClient({ apiKey: record.davoxiApiKey, apiUrl: config.davoxi.apiUrl });
    const [usage, businesses] = await Promise.all([
      client.getUsageSummary(),
      client.listBusinesses(),
    ]);

    res.json({
      results: [
        {
          objectId: 1,
          title: "Davoxi Voice AI",
          properties: [
            { label: "Total Calls", dataType: "NUMERIC", value: String(usage.total_calls) },
            { label: "Total Minutes", dataType: "NUMERIC", value: String(usage.total_minutes.toFixed(1)) },
            { label: "Total Cost", dataType: "CURRENCY", value: String(usage.total_cost.toFixed(2)), currencyCode: "USD" },
            { label: "Active Businesses", dataType: "NUMERIC", value: String(businesses.length) },
            { label: "Period", dataType: "STRING", value: `${usage.period_start.slice(0, 10)} to ${usage.period_end.slice(0, 10)}` },
          ],
        },
      ],
    });
  } catch (err) {
    console.error("CRM card error:", err);
    res.json({ results: [] });
  }
});

export default router;
