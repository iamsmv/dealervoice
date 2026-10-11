import { apiHandler, jsonBody } from "@/lib/api-route";
import { updateLeadStage } from "@/lib/crm-api";

// PATCH /api/v1/leads/{id}  {"stage": "negotiating"}
export const PATCH = apiHandler<RouteContext<"/api/v1/leads/[id]">>(async (businessId, request, ctx) => {
  const { id } = await ctx.params;
  const body = await jsonBody(request);
  return updateLeadStage(businessId, id, body.stage);
});
