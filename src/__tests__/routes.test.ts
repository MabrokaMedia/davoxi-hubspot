import express from "express";
import type { Express } from "express";

// Mock external dependencies before importing routes
jest.mock("node-fetch", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@davoxi/client", () => ({
  DavoxiClient: jest.fn().mockImplementation(() => ({
    getProfile: jest.fn(),
    listBusinesses: jest.fn(),
    listAgents: jest.fn(),
    getUsageSummary: jest.fn(),
  })),
}));

import * as hubspotClient from "../services/hubspot-client";
import * as tokenStore from "../services/token-store";
import { DavoxiClient } from "@davoxi/client";
import * as oauthModule from "../routes/oauth";

// We need a light HTTP test helper since supertest isn't installed
async function request(app: Express, method: string, path: string, body?: unknown) {
  return new Promise<{ status: number; body: unknown; headers: Record<string, string> }>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Bad server address");
      const port = addr.port;

      const url = `http://127.0.0.1:${port}${path}`;
      const headers: Record<string, string> = { Accept: "application/json" };
      const init: RequestInit = { method, headers };

      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }

      globalThis
        .fetch(url, { ...init, redirect: "manual" })
        .then(async (res) => {
          const text = await res.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          const responseHeaders: Record<string, string> = {};
          res.headers.forEach((v, k) => (responseHeaders[k] = v));
          resolve({ status: res.status, body: parsed, headers: responseHeaders });
          server.close();
        })
        .catch((err) => {
          console.error("Request error:", err);
          server.close();
        });
    });
  });
}

describe("routes", () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up token store
    tokenStore.deleteTokens("portal-1");
    tokenStore.deleteTokens("portal-2");
  });

  describe("OAuth routes", () => {
    beforeEach(() => {
      // Fresh app for each test to avoid route conflicts
      app = express();
      app.use(express.json());
      // Import fresh route -- but since jest modules are cached, we reuse
      const oauthRouter = require("../routes/oauth").default;
      app.use("/oauth", oauthRouter);
    });

    it("GET /oauth/authorize should redirect to HubSpot", async () => {
      const res = await request(app, "GET", "/oauth/authorize");

      // Should be a redirect (301/302/307)
      expect([301, 302, 307, 308]).toContain(res.status);
      expect(res.headers.location).toContain("hubspot.com/oauth/authorize");
    });

    it("GET /oauth/callback without code should return 400", async () => {
      const res = await request(app, "GET", "/oauth/callback");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Missing authorization code" });
    });

    it("GET /oauth/callback with valid code should exchange tokens and return success", async () => {
      // Mock exchangeCodeForTokens and getPortalId
      jest.spyOn(hubspotClient, "exchangeCodeForTokens").mockResolvedValue({
        access_token: "acc-123",
        refresh_token: "ref-456",
        expires_in: 3600,
      });
      jest.spyOn(hubspotClient, "getPortalId").mockResolvedValue("portal-1");

      const state = oauthModule.generateState();
      const res = await request(app, "GET", `/oauth/callback?code=test-code&state=${state}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        portalId: "portal-1",
      });
      // Verify tokens were saved
      expect(tokenStore.getTokens("portal-1")).toBeDefined();
    });

    it("GET /oauth/callback should return 500 when token exchange fails", async () => {
      jest
        .spyOn(hubspotClient, "exchangeCodeForTokens")
        .mockRejectedValue(new Error("exchange failed"));

      const state = oauthModule.generateState();
      const res = await request(app, "GET", `/oauth/callback?code=bad-code&state=${state}`);

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        error: "OAuth token exchange failed",
      });
    });
  });

  describe("Actions routes", () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      const actionsRouter = require("../routes/actions").default;
      app.use("/actions", actionsRouter);
    });

    it("GET /actions/businesses without portalId should return 400", async () => {
      const res = await request(app, "GET", "/actions/businesses");
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "portalId is required" });
    });

    it("GET /actions/businesses without API key should return 404", async () => {
      tokenStore.saveTokens({
        portalId: "portal-1",
        accessToken: "acc",
        refreshToken: "ref",
        expiresAt: Date.now() + 300_000,
      });

      const res = await request(app, "GET", "/actions/businesses?portalId=portal-1");
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: "Davoxi API key not configured" });
    });

    it("GET /actions/businesses with valid setup should return businesses", async () => {
      tokenStore.saveTokens({
        portalId: "portal-1",
        accessToken: "acc",
        refreshToken: "ref",
        expiresAt: Date.now() + 300_000,
        davoxiApiKey: "dvx-key",
      });

      const mockBusinesses = [{ id: "biz-1", name: "Test Biz" }];
      (DavoxiClient as unknown as jest.Mock).mockImplementation(() => ({
        listBusinesses: jest.fn().mockResolvedValue(mockBusinesses),
      }));

      const res = await request(app, "GET", "/actions/businesses?portalId=portal-1");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockBusinesses);
    });

    it("GET /actions/agents without required params should return 400", async () => {
      const res = await request(app, "GET", "/actions/agents?portalId=portal-1");
      expect(res.status).toBe(400);
    });

    it("GET /actions/usage without portalId should return 400", async () => {
      const res = await request(app, "GET", "/actions/usage");
      expect(res.status).toBe(400);
    });

    it("GET /actions/usage with valid setup should return usage", async () => {
      tokenStore.saveTokens({
        portalId: "portal-1",
        accessToken: "acc",
        refreshToken: "ref",
        expiresAt: Date.now() + 300_000,
        davoxiApiKey: "dvx-key",
      });

      const mockUsage = { total_calls: 10, total_minutes: 55.5, total_cost: 12.5 };
      (DavoxiClient as unknown as jest.Mock).mockImplementation(() => ({
        getUsageSummary: jest.fn().mockResolvedValue(mockUsage),
      }));

      const res = await request(app, "GET", "/actions/usage?portalId=portal-1");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockUsage);
    });
  });

  describe("Settings routes", () => {
    beforeEach(() => {
      app = express();
      app.use(express.json());
      const settingsRouter = require("../routes/settings").default;
      app.use("/settings", settingsRouter);
    });

    it("POST /settings/api-key without required fields should return 400", async () => {
      const res = await request(app, "POST", "/settings/api-key", { portalId: "portal-1" });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "portalId and apiKey are required" });
    });

    it("POST /settings/api-key for unconnected portal should return 404", async () => {
      const res = await request(app, "POST", "/settings/api-key", {
        portalId: "unknown",
        apiKey: "some-key",
      });
      expect(res.status).toBe(404);
    });

    it("POST /settings/api-key with invalid Davoxi key should return 401", async () => {
      tokenStore.saveTokens({
        portalId: "portal-1",
        accessToken: "acc",
        refreshToken: "ref",
        expiresAt: Date.now() + 300_000,
      });

      (DavoxiClient as unknown as jest.Mock).mockImplementation(() => ({
        getProfile: jest.fn().mockRejectedValue(new Error("unauthorized")),
      }));

      const res = await request(app, "POST", "/settings/api-key", {
        portalId: "portal-1",
        apiKey: "bad-key",
      });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: "Invalid Davoxi API key" });
    });

    it("POST /settings/api-key with valid key should save and return success", async () => {
      tokenStore.saveTokens({
        portalId: "portal-1",
        accessToken: "acc",
        refreshToken: "ref",
        expiresAt: Date.now() + 300_000,
      });

      (DavoxiClient as unknown as jest.Mock).mockImplementation(() => ({
        getProfile: jest.fn().mockResolvedValue({ id: "user-1" }),
      }));

      const res = await request(app, "POST", "/settings/api-key", {
        portalId: "portal-1",
        apiKey: "valid-key",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });

      // Verify key was stored
      const record = tokenStore.getTokens("portal-1");
      expect(record?.davoxiApiKey).toBe("valid-key");
    });
  });
});
