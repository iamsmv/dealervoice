import { apiHandler } from "@/lib/api-route";
import { listTickets } from "@/lib/crm-api";

// GET /api/v1/tickets?status=open&limit=50
export const GET = apiHandler(async (businessId, request) => {
  const params = new URL(request.url).searchParams;
  return listTickets(businessId, { status: params.get("status") ?? undefined, limit: Number(params.get("limit")) || undefined });
});
