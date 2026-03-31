export const config = {
  hubspot: {
    clientId: process.env.HUBSPOT_CLIENT_ID || "",
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET || "",
    apiDomain: "https://api.hubapi.com",
    oauthUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.deals.read",
      "crm.objects.deals.write",
      "timeline",
    ],
  },
  davoxi: {
    apiUrl: process.env.DAVOXI_API_URL || "https://api.davoxi.com",
  },
  port: parseInt(process.env.PORT || "3001", 10),
  appUrl: process.env.APP_URL || "http://localhost:3001",
};
