import crypto from "crypto";
import type { Request } from "express";
import { verifyHubSpotSignature, verifyDavoxiSignature } from "../routes/webhooks";

function makeReq(headers: Record<string, string>, body: string | Buffer): Request {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  return {
    headers,
    rawBody: buf,
  } as unknown as Request;
}

describe("verifyHubSpotSignature", () => {
  const secret = "client-secret-x";
  const body = JSON.stringify([{ portalId: 42, eventId: 1 }]);
  const expected = crypto.createHash("sha256").update(secret + body).digest("hex");

  beforeAll(() => {
    process.env.HUBSPOT_CLIENT_SECRET = secret;
  });
  afterAll(() => {
    delete process.env.HUBSPOT_CLIENT_SECRET;
  });

  it("accepts a hex signature that matches sha256(secret + body)", () => {
    const req = makeReq({ "x-hubspot-signature": expected }, body);
    expect(verifyHubSpotSignature(req)).toBe(true);
  });

  it("rejects a tampered signature of correct length", () => {
    const tampered = expected.replace(/[0-9a-f]$/, (c) => (c === "f" ? "0" : "f"));
    const req = makeReq({ "x-hubspot-signature": tampered }, body);
    expect(verifyHubSpotSignature(req)).toBe(false);
  });

  it("rejects a signature shorter than expected", () => {
    const req = makeReq({ "x-hubspot-signature": expected.slice(0, 10) }, body);
    expect(verifyHubSpotSignature(req)).toBe(false);
  });

  it("rejects a non-hex signature", () => {
    const req = makeReq({ "x-hubspot-signature": "z".repeat(expected.length) }, body);
    expect(verifyHubSpotSignature(req)).toBe(false);
  });

  it("rejects when no signature header", () => {
    const req = makeReq({}, body);
    expect(verifyHubSpotSignature(req)).toBe(false);
  });

  it("rejects when no rawBody", () => {
    const req = { headers: { "x-hubspot-signature": expected } } as unknown as Request;
    expect(verifyHubSpotSignature(req)).toBe(false);
  });
});

describe("verifyDavoxiSignature", () => {
  const secret = "davoxi-webhook-secret";
  const body = JSON.stringify({ event: "call.completed", portalId: "abc-12345" });
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");

  beforeAll(() => {
    process.env.DAVOXI_WEBHOOK_SECRET = secret;
  });
  afterAll(() => {
    delete process.env.DAVOXI_WEBHOOK_SECRET;
  });

  it("accepts an HMAC-SHA256 signature in hex", () => {
    const req = makeReq({ "x-davoxi-signature": expected }, body);
    expect(verifyDavoxiSignature(req)).toBe(true);
  });

  it("rejects a non-hex signature even when length is right", () => {
    const req = makeReq({ "x-davoxi-signature": "Z".repeat(expected.length) }, body);
    expect(verifyDavoxiSignature(req)).toBe(false);
  });

  it("rejects when secret env var is unset", () => {
    const saved = process.env.DAVOXI_WEBHOOK_SECRET;
    delete process.env.DAVOXI_WEBHOOK_SECRET;
    const req = makeReq({ "x-davoxi-signature": expected }, body);
    expect(verifyDavoxiSignature(req)).toBe(false);
    process.env.DAVOXI_WEBHOOK_SECRET = saved;
  });
});
