import "server-only";
import { NextResponse } from "next/server";
import { businessFromRequest } from "@/lib/api-keys";
import { ApiError } from "@/lib/crm-api";

// Wraps a public API handler: checks the API key, turns errors into JSON.
export function apiHandler<C>(fn: (businessId: string, request: Request, ctx: C) => Promise<unknown>) {
  return async (request: Request, ctx: C) => {
    const businessId = await businessFromRequest(request);
    if (!businessId) return NextResponse.json({ error: "Missing or invalid API key. Send: Authorization: Bearer dv_live_…" }, { status: 401 });
    try {
      return NextResponse.json({ data: await fn(businessId, request, ctx) });
    } catch (err) {
      if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error("API error:", err);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Send a JSON object body");
  return body as Record<string, unknown>;
}
