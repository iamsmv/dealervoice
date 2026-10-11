import { apiHandler } from "@/lib/api-route";
import { listBookings } from "@/lib/crm-api";

// GET /api/v1/bookings?upcoming=true&limit=50
export const GET = apiHandler(async (businessId, request) => {
  const params = new URL(request.url).searchParams;
  return listBookings(businessId, { upcoming: params.get("upcoming") === "true", limit: Number(params.get("limit")) || undefined });
});
