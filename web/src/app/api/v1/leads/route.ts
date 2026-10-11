import { apiHandler, jsonBody } from "@/lib/api-route";
import { createLead, listLeads } from "@/lib/crm-api";

// GET /api/v1/leads?search=ravi&stage=new&limit=50
export const GET = apiHandler(async (businessId, request) => {
  const params = new URL(request.url).searchParams;
  return listLeads(businessId, {
    search: params.get("search") ?? undefined,
    stage: params.get("stage") ?? undefined,
    limit: Number(params.get("limit")) || undefined,
  });
});

// POST /api/v1/leads  {"name": "Ravi", "phone": "9876543210", "email": "...", "car_interest": "Nexon"}
export const POST = apiHandler(async (businessId, request) => createLead(businessId, await jsonBody(request)));
