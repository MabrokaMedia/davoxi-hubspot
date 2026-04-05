import { exchangeCodeForTokens, refreshAccessToken, getValidToken, hubspotRequest, getPortalId } from "../services/hubspot-client";
import * as tokenStore from "../services/token-store";

// Mock node-fetch at module level
jest.mock("node-fetch", () => {
  const mockFetch = jest.fn();
  return {
    __esModule: true,
    default: mockFetch,
  };
});

// Get a reference to the mocked fetch
import fetch from "node-fetch";
const mockFetch = fetch as unknown as jest.Mock;

describe("hubspot-client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    tokenStore.deleteTokens("portal-1");
  });

  // Helper to create a mock Response
  function mockResponse(body: unknown, status = 200, ok = true) {
    return {
      ok,
      status,
      text: jest.fn().mockResolvedValue(typeof body === "string" ? body : JSON.stringify(body)),
      json: jest.fn().mockResolvedValue(body),
    };
  }

  describe("exchangeCodeForTokens", () => {
    it("should POST to token URL and return token data on success", async () => {
      const tokenData = {
        access_token: "acc-123",
        refresh_token: "ref-456",
        expires_in: 3600,
      };
      mockFetch.mockResolvedValue(mockResponse(tokenData));

      const result = await exchangeCodeForTokens("auth-code-xyz");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/oauth/v1/token");
      expect(options.method).toBe("POST");
      expect(options.body.toString()).toContain("grant_type=authorization_code");
      expect(options.body.toString()).toContain("code=auth-code-xyz");
      expect(result).toEqual(tokenData);
    });

    it("should throw on non-OK response", async () => {
      mockFetch.mockResolvedValue(mockResponse("bad request", 400, false));

      await expect(exchangeCodeForTokens("bad-code")).rejects.toThrow(
        /HubSpot token exchange failed \(400\)/,
      );
    });
  });

  describe("refreshAccessToken", () => {
    it("should POST with refresh_token grant and return new tokens", async () => {
      const tokenData = {
        access_token: "new-acc",
        refresh_token: "new-ref",
        expires_in: 3600,
      };
      mockFetch.mockResolvedValue(mockResponse(tokenData));

      const result = await refreshAccessToken("old-refresh-token");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.body.toString()).toContain("grant_type=refresh_token");
      expect(options.body.toString()).toContain("refresh_token=old-refresh-token");
      expect(result).toEqual(tokenData);
    });

    it("should throw on non-OK response", async () => {
      mockFetch.mockResolvedValue(mockResponse("invalid refresh token", 401, false));

      await expect(refreshAccessToken("bad-token")).rejects.toThrow(
        /HubSpot token refresh failed \(401\)/,
      );
    });
  });

  describe("getPortalId", () => {
    it("should GET the token info URL and return the hub_id as string", async () => {
      mockFetch.mockResolvedValue(mockResponse({ hub_id: 12345 }));

      const result = await getPortalId("some-access-token");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("some-access-token");
      expect(result).toBe("12345");
    });

    it("should throw when the request fails", async () => {
      mockFetch.mockResolvedValue(mockResponse("not found", 404, false));

      await expect(getPortalId("bad-token")).rejects.toThrow(
        "Failed to get token info from HubSpot",
      );
    });
  });

  describe("getValidToken", () => {
    it("should return cached token when not expired", async () => {
      tokenStore.saveTokens({
        portalId: "portal-1",
        accessToken: "valid-token",
        refreshToken: "ref-token",
        expiresAt: Date.now() + 300_000, // expires in 5 minutes (> 1 minute buffer)
      });

      const token = await getValidToken("portal-1");

      expect(token).toBe("valid-token");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should refresh when token is within 60 seconds of expiry", async () => {
      tokenStore.saveTokens({
        portalId: "portal-1",
        accessToken: "expired-token",
        refreshToken: "ref-token",
        expiresAt: Date.now() + 30_000, // expires in 30s, within 60s buffer
      });

      const refreshedTokenData = {
        access_token: "refreshed-token",
        refresh_token: "new-ref",
        expires_in: 3600,
      };
      mockFetch.mockResolvedValue(mockResponse(refreshedTokenData));

      const token = await getValidToken("portal-1");

      expect(token).toBe("refreshed-token");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Verify the new token was saved
      const stored = tokenStore.getTokens("portal-1");
      expect(stored?.accessToken).toBe("refreshed-token");
    });

    it("should throw when no tokens exist for the portal", async () => {
      await expect(getValidToken("unknown-portal")).rejects.toThrow(
        /No tokens found for portal unknown-portal/,
      );
    });
  });

  describe("hubspotRequest", () => {
    beforeEach(() => {
      // Store valid tokens so getValidToken succeeds
      tokenStore.saveTokens({
        portalId: "portal-1",
        accessToken: "valid-token",
        refreshToken: "ref-token",
        expiresAt: Date.now() + 300_000,
      });
    });

    it("should make a GET request with auth header", async () => {
      const responseData = { id: "contact-1", name: "Test" };
      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await hubspotRequest("portal-1", "GET", "/crm/v3/contacts/1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/crm/v3/contacts/1");
      expect(options.method).toBe("GET");
      expect(options.headers.Authorization).toBe("Bearer valid-token");
      expect(options.body).toBeUndefined();
      expect(result).toEqual(responseData);
    });

    it("should make a POST request with JSON body", async () => {
      const requestBody = { email: "test@example.com" };
      const responseData = { id: "new-contact" };
      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await hubspotRequest("portal-1", "POST", "/crm/v3/contacts", requestBody);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.body).toBe(JSON.stringify(requestBody));
      expect(result).toEqual(responseData);
    });

    it("should return undefined for 204 No Content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        text: jest.fn().mockResolvedValue(""),
      });

      const result = await hubspotRequest("portal-1", "DELETE", "/crm/v3/contacts/1");
      expect(result).toBeUndefined();
    });

    it("should throw on error response", async () => {
      mockFetch.mockResolvedValue(mockResponse("Not Found", 404, false));

      await expect(
        hubspotRequest("portal-1", "GET", "/crm/v3/contacts/missing"),
      ).rejects.toThrow(/HubSpot API error \(404\)/);
    });
  });
});
