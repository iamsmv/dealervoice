import { NextResponse } from "next/server";
import { businessFromRequest } from "@/lib/api-keys";
import { ApiError, createLead, listBookings, listCampaignSummaries, listLeads, listRecentCalls, listTickets, updateLeadStage } from "@/lib/crm-api";
import { STAGES } from "@/lib/leads";

// DealerVoice MCP server (Streamable HTTP, stateless JSON responses).
// Lets Claude / Cursor work with one dealership's CRM using its API key. No calling, no deleting.

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const stages = STAGES.map((s) => s.id);
const TOOLS = [
  {
    name: "list_leads",
    description: "List the dealership's leads, newest first. Optionally search by name, email or phone, or filter by stage.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of a name, email or phone number" },
        stage: { type: "string", enum: stages },
        limit: { type: "number", description: "Max results (1–200, default 50)" },
      },
    },
  },
  {
    name: "create_lead",
    description: "Add a new lead to the CRM.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string", description: "Indian mobile number, e.g. 9876543210 or +919876543210" },
        email: { type: "string" },
        car_interest: { type: "string", description: "Car model they're interested in, e.g. Nexon" },
      },
      required: ["name", "phone"],
    },
  },
  {
    name: "update_lead_stage",
    description: "Move a lead to another pipeline stage.",
    inputSchema: {
      type: "object",
      properties: { lead_id: { type: "string" }, stage: { type: "string", enum: stages } },
      required: ["lead_id", "stage"],
    },
  },
  {
    name: "list_bookings",
    description: "List test-drive / visit bookings. Set upcoming=true for future bookings only.",
    inputSchema: { type: "object", properties: { upcoming: { type: "boolean" }, limit: { type: "number" } } },
  },
  {
    name: "list_recent_calls",
    description: "Recent phone and browser calls handled by the AI receptionist, with outcome and duration.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "1–100, default 20" } } },
  },
  {
    name: "list_campaigns",
    description: "Outbound calling campaigns and their progress.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_support_tickets",
    description: "Support tickets the receptionist opened for existing customers (newest first).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "in_progress", "waiting_customer", "resolved", "closed"] },
        limit: { type: "number", description: "Max tickets, default 50" },
      },
    },
  },
] as const;

async function runTool(businessId: string, name: string, args: Record<string, unknown>) {
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (name) {
    case "list_leads":
      return listLeads(businessId, { search: str(args.search), stage: str(args.stage), limit: num(args.limit) });
    case "create_lead":
      return createLead(businessId, args);
    case "update_lead_stage":
      return updateLeadStage(businessId, String(args.lead_id ?? ""), args.stage);
    case "list_bookings":
      return listBookings(businessId, { upcoming: args.upcoming === true, limit: num(args.limit) });
    case "list_recent_calls":
      return listRecentCalls(businessId, num(args.limit) ?? 20);
    case "list_campaigns":
      return listCampaignSummaries(businessId);
    case "list_support_tickets":
      return listTickets(businessId, { status: str(args.status), limit: num(args.limit) });
    default:
      throw new ApiError(404, `Unknown tool: ${name}`);
  }
}

const reply = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(businessId: string, msg: Rpc) {
  switch (msg.method) {
    case "initialize":
      return reply(msg.id, {
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "dealervoice", version: "1.0.0" },
        instructions: "DealerVoice CRM for one car dealership: leads, pipeline stages, bookings, AI receptionist calls and campaigns.",
      });
    case "ping":
      return reply(msg.id, {});
    case "tools/list":
      return reply(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const data = await runTool(businessId, name, args);
        return reply(msg.id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Something went wrong";
        if (!(err instanceof ApiError)) console.error("MCP tool error:", err);
        return reply(msg.id, { content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(request: Request) {
  const businessId = await businessFromRequest(request);
  if (!businessId) return NextResponse.json(fail(null, -32001, "Missing or invalid API key"), { status: 401 });

  const body = (await request.json().catch(() => null)) as Rpc | Rpc[] | null;
  if (!body) return NextResponse.json(fail(null, -32700, "Parse error"), { status: 400 });

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const msg of messages) {
    if (msg.id === undefined) continue; // notifications (e.g. notifications/initialized) need no reply
    responses.push(await handle(businessId, msg));
  }
  if (!responses.length) return new Response(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0]);
}

// This server doesn't push events, so there's no stream to open.
export function GET() {
  return new Response("Use POST", { status: 405, headers: { Allow: "POST" } });
}
