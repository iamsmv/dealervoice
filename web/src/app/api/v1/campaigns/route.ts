import { apiHandler } from "@/lib/api-route";
import { listCampaignSummaries } from "@/lib/crm-api";

// GET /api/v1/campaigns
export const GET = apiHandler(async (businessId) => listCampaignSummaries(businessId));
