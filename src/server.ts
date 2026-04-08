import express, { Request } from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import oauthRoutes from "./routes/oauth";
import settingsRoutes from "./routes/settings";
import webhookRoutes from "./routes/webhooks";
import crmCardRoutes from "./routes/crm-card";
import actionRoutes from "./routes/actions";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : false,
  }),
);

// Parse JSON and capture raw body for webhook signature verification
app.use(
  express.json({
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Health check (public)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "davoxi-hubspot" });
});

// OAuth routes are public (required for HubSpot OAuth flow)
app.use("/oauth", oauthRoutes);

// All other routes require a valid internal API key
app.use("/settings", apiKeyAuth, settingsRoutes);
app.use("/webhooks", apiKeyAuth, webhookRoutes);
app.use("/crm-card", apiKeyAuth, crmCardRoutes);
app.use("/actions", apiKeyAuth, actionRoutes);

app.listen(config.port, () => {
  console.log(`Davoxi HubSpot integration running on port ${config.port}`);
});

export default app;
