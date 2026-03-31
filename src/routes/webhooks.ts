import { Router } from "express";
import { getTokens } from "../services/token-store";
import { hubspotRequest } from "../services/hubspot-client";

const router = Router();

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
router.post("/hubspot", async (req, res) => {
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
          const contact = await hubspotRequest<{
            properties: { firstname?: string; lastname?: string; phone?: string; email?: string };
          }>(portalId, "GET", `/crm/v3/objects/contacts/${event.objectId}`);

          console.log(
            `New HubSpot contact: ${contact.properties.firstname} ${contact.properties.lastname} (${contact.properties.phone})`,
          );
          break;
        }

        case "deal.creation": {
          const deal = await hubspotRequest<{
            properties: { dealname?: string; amount?: string; dealstage?: string };
          }>(portalId, "GET", `/crm/v3/objects/deals/${event.objectId}`);

          console.log(`New HubSpot deal: ${deal.properties.dealname} ($${deal.properties.amount})`);
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
router.post("/davoxi", async (req, res) => {
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

        // Create a note engagement with call summary
        await hubspotRequest(portalId, "POST", "/crm/v3/objects/notes", {
          properties: {
            hs_note_body: `<h3>Davoxi AI Call Summary</h3><p><strong>Duration:</strong> ${payload.duration}s</p><p>${payload.summary || "No summary available"}</p>${payload.recordingUrl ? `<p><a href="${payload.recordingUrl}">Listen to recording</a></p>` : ""}`,
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
