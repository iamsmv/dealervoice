import { apiHandler } from "@/lib/api-route";
import { listRecentCalls } from "@/lib/crm-api";

// GET /api/v1/calls?limit=20
export const GET = apiHandler(async (businessId, request) =>
  listRecentCalls(businessId, Number(new URL(request.url).searchParams.get("limit")) || 20),
);
