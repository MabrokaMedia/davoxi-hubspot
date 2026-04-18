import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getTokens } from "../services/token-store";
import { hubspotRequest } from "../services/hubspot-client";

const router = Router();

// --- Helpers ---

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function verifyHubSpotSignature(req: Request): boolean {
  const signature = req.headers["x-hubspot-signature"] as string | undefined;
  const secret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!signature || !secret) return false;

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) return false;

  const expected = crypto
    .createHash("sha256")
    .update(secret + rawBody.toString("utf8"))
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyDavoxiSignature(req: Request): boolean {
  const signature = req.headers["x-davoxi-signature"] as string | undefined;
  const secret = process.env.DAVOXI_WEBHOOK_SECRET;
  if (!signature || !secret) return false;

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionId: number;
  portalId: number;
  occurredAt: number;
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
}

/**
 * POST /webhooks/hubspot — Handle incoming HubSpot webhook events.
 *
 * Events:
 *   - contact.creation: New contact created in HubSpot
 *   - deal.creation: New deal created
 *   - contact.propertyChange: Contact property updated
 */
router.post("/hubspot", async (req: Request, res: Response) => {
  if (!verifyHubSpotSignature(req)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const events = req.body as HubSpotWebhookEvent[];

  // Acknowledge immediately
  res.status(200).send();

  for (const event of events) {
    const portalId = String(event.portalId);
    const record = getTokens(portalId);
    if (!record?.davoxiApiKey) continue;

    try {
      switch (event.subscriptionType) {
        case "contact.creation": {
          await hubspotRequest<{
            properties: { firstname?: string; lastname?: string; phone?: string; email?: string };
          }>(portalId, "GET", `/crm/v3/objects/contacts/${event.objectId}`);

          // Log only the object ID, not name/phone (PII)
          console.log(`New HubSpot contact created: objectId=${event.objectId}`);
          break;
        }

        case "deal.creation": {
          await hubspotRequest<{
            properties: { dealname?: string; amount?: string; dealstage?: string };
          }>(portalId, "GET", `/crm/v3/objects/deals/${event.objectId}`);

          // Log only the object ID — deal name and amount may contain PII / sensitive financial data
          console.log(`New HubSpot deal created: objectId=${event.objectId}`);
          break;
        }

        default:
          console.log(`Unhandled HubSpot event: ${event.subscriptionType}`);
      }
    } catch (err) {
      console.error(`Error processing HubSpot webhook:`, err);
    }
  }
});

/**
 * POST /webhooks/davoxi — Handle incoming Davoxi webhook events.
 *
 * Events:
 *   - call.completed: Log call to HubSpot contact timeline via Engagements API
 */
router.post("/davoxi", async (req: Request, res: Response) => {
  if (!verifyDavoxiSignature(req)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = req.body as {
    event: string;
    portalId?: string;
    contactPhone?: string;
    contactEmail?: string;
    summary?: string;
    duration?: number;
    recordingUrl?: string;
    [key: string]: unknown;
  };

  res.status(200).json({ received: true });

  const portalId = payload.portalId;
  if (!portalId) return;

  const record = getTokens(portalId);
  if (!record) return;

  try {
    switch (payload.event) {
      case "call.completed": {
        // Search for contact by email or phone
        let contactId: string | undefined;

        if (payload.contactEmail) {
          const search = await hubspotRequest<{
            results: Array<{ id: string }>;
          }>(portalId, "POST", "/crm/v3/objects/contacts/search", {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "email",
                    operator: "EQ",
                    value: payload.contactEmail,
                  },
                ],
              },
            ],
          });
          if (search.results.length > 0) {
            contactId = search.results[0].id;
          }
        }

        if (!contactId && payload.contactPhone) {
          const search = await hubspotRequest<{
            results: Array<{ id: string }>;
          }>(portalId, "POST", "/crm/v3/objects/contacts/search", {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "phone",
                    operator: "EQ",
                    value: payload.contactPhone,
                  },
                ],
              },
            ],
          });
          if (search.results.length > 0) {
            contactId = search.results[0].id;
          }
        }

        if (!contactId) {
          console.log("No matching HubSpot contact found for call log");
          break;
        }

        // HTML-encode user-supplied content before embedding in HTML
        const safeSummary = escapeHtml(payload.summary || "No summary available");
        const rawRecordingUrl = payload.recordingUrl ?? "";
        const safeRecordingUrl = rawRecordingUrl.startsWith("https://") ? rawRecordingUrl : "";
        const recordingLink = safeRecordingUrl
          ? `<p><a href="${safeRecordingUrl}">Listen to recording</a></p>`
          : "";

        // Create a note engagement with call summary
        await hubspotRequest(portalId, "POST", "/crm/v3/objects/notes", {
          properties: {
            hs_note_body: `<h3>Davoxi AI Call Summary</h3><p><strong>Duration:</strong> ${payload.duration}s</p><p>${safeSummary}</p>${recordingLink}`,
            hs_timestamp: new Date().toISOString(),
          },
          associations: [
            {
              to: { id: contactId },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: 202,
                },
              ],
            },
          ],
        });

        console.log(`Call summary logged to HubSpot contact ${contactId}`);
        break;
      }

      default:
        console.log(`Unhandled Davoxi webhook event: ${payload.event}`);
    }
  } catch (err) {
    console.error(`Error processing Davoxi webhook:`, err);
  }
});

export default router;
