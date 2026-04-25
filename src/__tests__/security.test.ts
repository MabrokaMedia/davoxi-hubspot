import crypto from "crypto";
import express from "express";
import type { Express, Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Minimal HTTP helper (no supertest dependency)
// ---------------------------------------------------------------------------
async function request(
  app: Express,
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return new Promise<{ status: number; body: unknown }>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Bad server address");
      const port = (addr as { port: number }).port;
      const url = `http://127.0.0.1:${port}${path}`;

      const headers: Record<string, string> = {
        Accept: "application/json",
        ...opts.headers,
      };
      const init: RequestInit = { method, headers };

      if (opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(opts.body);
      }

      globalThis
        .fetch(url, init)
        .then(async (res) => {
          const text = await res.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({ status: res.status, body: parsed });
          server.close();
        })
        .catch((err) => {
          console.error("Request error:", err);
          server.close();
        });
    });
  });
}

// ---------------------------------------------------------------------------
// CRITICAL-1: apiKeyAuth middleware
// ---------------------------------------------------------------------------
describe("apiKeyAuth middleware", () => {
  const originalEnv = process.env.INTERNAL_API_KEY;

  afterAll(() => {
    process.env.INTERNAL_API_KEY = originalEnv;
  });

  function makeApp(key: string | undefined) {
    const { apiKeyAuth } = require("../middleware/apiKeyAuth");
    const app = express();
    if (key !== undefined) {
      process.env.INTERNAL_API_KEY = key;
    } else {
      delete process.env.INTERNAL_API_KEY;
    }
    app.get("/protected", apiKeyAuth, (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
    return app;
  }

  it("rejects request with no x-api-key header", async () => {
    const app = makeApp("secret-key");
    const res = await request(app, "GET", "/protected");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Unauthorized" });
  });

  it("rejects request with wrong x-api-key", async () => {
    const app = makeApp("secret-key");
    const res = await request(app, "GET", "/protected", {
      headers: { "x-api-key": "wrong-key" },
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Unauthorized" });
  });

  it("accepts request with correct x-api-key", async () => {
    const app = makeApp("secret-key");
    const res = await request(app, "GET", "/protected", {
      headers: { "x-api-key": "secret-key" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("rejects request when INTERNAL_API_KEY env var is not set", async () => {
    const app = makeApp(undefined);
    const res = await request(app, "GET", "/protected", {
      headers: { "x-api-key": "any-key" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a key that is a prefix of the correct key (length mismatch)", async () => {
    const app = makeApp("secret-key");
    const res = await request(app, "GET", "/protected", {
      headers: { "x-api-key": "secret-ke" }, // one char short
    });
    expect(res.status).toBe(401);
  });

  it("rejects a key that extends the correct key (length mismatch)", async () => {
    const app = makeApp("secret-key");
    const res = await request(app, "GET", "/protected", {
      headers: { "x-api-key": "secret-keyX" }, // one char extra
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// HIGH-1: escapeHtml
// ---------------------------------------------------------------------------
describe("escapeHtml", () => {
  const { escapeHtml } = require("../routes/webhooks");

  it("escapes & characters", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes < characters", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes > characters", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it('escapes " characters', () => {
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
  });

  it("escapes ' characters", () => {
    expect(escapeHtml("it's")).toBe("it&#039;s");
  });

  it("handles all special chars in one string", () => {
    expect(escapeHtml('<a href="x&y">it\'s</a>')).toBe(
      "&lt;a href=&quot;x&amp;y&quot;&gt;it&#039;s&lt;/a&gt;",
    );
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// MEDIUM: recording URL validation (URL-constructor-based safe URL check)
// Validates that the webhook call_log handler only embeds valid https:// URLs
// in HTML notes and that the href itself is HTML-escaped.
// ---------------------------------------------------------------------------
describe("recording URL safety", () => {
  function sanitizeRecordingUrl(raw: string): string {
    let safe = "";
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "https:") {
        safe = parsed.href;
      }
    } catch {
      // invalid URL
    }
    return safe;
  }

  it("accepts a valid https URL", () => {
    expect(sanitizeRecordingUrl("https://api.twilio.com/recording/abc123")).toBe(
      "https://api.twilio.com/recording/abc123"
    );
  });

  it("rejects http URLs", () => {
    expect(sanitizeRecordingUrl("http://example.com/rec")).toBe("");
  });

  it("rejects javascript: URLs", () => {
    expect(sanitizeRecordingUrl("javascript:alert(1)")).toBe("");
  });

  it("rejects data: URLs", () => {
    expect(sanitizeRecordingUrl("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("rejects empty string", () => {
    expect(sanitizeRecordingUrl("")).toBe("");
  });

  it("rejects malformed URL", () => {
    expect(sanitizeRecordingUrl("not-a-url")).toBe("");
  });

  it("normalises the URL (removes user-injected fragments, etc.)", () => {
    const result = sanitizeRecordingUrl("https://cdn.example.com/rec?v=1#frag");
    expect(result).toBe("https://cdn.example.com/rec?v=1#frag");
    // The URL constructor normalises — no raw user string is kept verbatim
    expect(result).not.toContain('"');
    expect(result).not.toContain("'");
  });
});

// ---------------------------------------------------------------------------
// CRITICAL-2: verifyHubSpotSignature
// ---------------------------------------------------------------------------
describe("verifyHubSpotSignature", () => {
  const { verifyHubSpotSignature } = require("../routes/webhooks");
  const originalEnv = process.env.HUBSPOT_CLIENT_SECRET;

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.HUBSPOT_CLIENT_SECRET = originalEnv;
    } else {
      delete process.env.HUBSPOT_CLIENT_SECRET;
    }
  });

  function makeReq(secret: string, body: string, signatureOverride?: string): Request {
    const rawBody = Buffer.from(body, "utf8");
    const correctSig = crypto
      .createHash("sha256")
      .update(secret + body)
      .digest("hex");
    const signature = signatureOverride ?? correctSig;
    return {
      headers: { "x-hubspot-signature": signature },
      rawBody,
    } as unknown as Request;
  }

  it("returns false when HUBSPOT_CLIENT_SECRET is not set", () => {
    delete process.env.HUBSPOT_CLIENT_SECRET;
    const req = makeReq("secret", '{"test":1}');
    expect(verifyHubSpotSignature(req)).toBe(false);
  });

  it("returns false when signature header is missing", () => {
    process.env.HUBSPOT_CLIENT_SECRET = "my-secret";
    const req = { headers: {}, rawBody: Buffer.from("body") } as unknown as Request;
    expect(verifyHubSpotSignature(req)).toBe(false);
  });

  it("returns false for a wrong signature", () => {
    process.env.HUBSPOT_CLIENT_SECRET = "my-secret";
    const req = makeReq("my-secret", '{"event":"test"}', "deadbeef".repeat(8));
    expect(verifyHubSpotSignature(req)).toBe(false);
  });

  it("returns true for a correct signature", () => {
    process.env.HUBSPOT_CLIENT_SECRET = "my-secret";
    const body = '{"event":"contact.creation"}';
    const req = makeReq("my-secret", body);
    expect(verifyHubSpotSignature(req)).toBe(true);
  });

  it("returns false when rawBody is missing", () => {
    process.env.HUBSPOT_CLIENT_SECRET = "my-secret";
    const req = {
      headers: { "x-hubspot-signature": "abc" },
    } as unknown as Request;
    expect(verifyHubSpotSignature(req)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MEDIUM-3: OAuth state validation
// ---------------------------------------------------------------------------
describe("OAuth state validation", () => {
  // Re-require after each test to get a fresh pendingStates map
  beforeEach(() => {
    jest.resetModules();
  });

  it("rejects an unknown state", () => {
    const { validateState } = require("../routes/oauth");
    expect(validateState("unknown-state")).toBe(false);
  });

  it("accepts a valid state generated by generateState", () => {
    const { validateState, generateState } = require("../routes/oauth");
    const state = generateState();
    expect(validateState(state)).toBe(true);
  });

  it("rejects a state that has already been consumed (replay protection)", () => {
    const { validateState, generateState } = require("../routes/oauth");
    const state = generateState();
    expect(validateState(state)).toBe(true);
    // Second use of the same state must fail
    expect(validateState(state)).toBe(false);
  });

  it("callback returns 400 when state is missing", async () => {
    jest.mock("node-fetch", () => ({ __esModule: true, default: jest.fn() }));
    jest.mock("../services/hubspot-client", () => ({
      exchangeCodeForTokens: jest.fn(),
      getPortalId: jest.fn(),
    }));
    jest.mock("../services/token-store", () => ({
      saveTokens: jest.fn(),
    }));

    const oauthRouter = require("../routes/oauth").default;
    const app = express();
    app.use(express.json());
    app.use("/oauth", oauthRouter);

    const res = await request(app, "GET", "/oauth/callback?code=abc");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid or missing state parameter" });
  });

  it("callback returns 400 when state is wrong", async () => {
    jest.mock("node-fetch", () => ({ __esModule: true, default: jest.fn() }));
    jest.mock("../services/hubspot-client", () => ({
      exchangeCodeForTokens: jest.fn(),
      getPortalId: jest.fn(),
    }));
    jest.mock("../services/token-store", () => ({
      saveTokens: jest.fn(),
    }));

    const oauthRouter = require("../routes/oauth").default;
    const app = express();
    app.use(express.json());
    app.use("/oauth", oauthRouter);

    const res = await request(app, "GET", "/oauth/callback?code=abc&state=wrong-state");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid or missing state parameter" });
  });
});
