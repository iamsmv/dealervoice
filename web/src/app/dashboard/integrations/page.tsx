import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import { CalendarForm, WebhookForm } from "../settings/settings-forms";
import { Badge, PageHeader } from "../ui";
import { zohoConnection } from "@/lib/zoho";
import { ApiKeyPanel, ConnectDograhForm, DeveloperDocs } from "./integration-forms";

export default async function IntegrationsPage({ searchParams }: PageProps<"/dashboard/integrations">) {
  const { zoho: zohoResult } = (await searchParams) as Record<string, string | undefined>;
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, agent_name, dograh_workflow_id, cal_event_type_id, webhook_url")
    .maybeSingle();
  if (!business) redirect("/dashboard");

  // Secrets are read on the server only; the page gets just enough to show status.
  const { data: secrets } = await createAdminClient()
    .from("business_secrets")
    .select("cal_api_key, webhook_secret, dograh_api_key, api_key_hint, api_key_created_at")
    .eq("business_id", business.id)
    .maybeSingle();
  const ending = (key: string | null | undefined) => (key ? key.slice(-4) : null);
  const whatsappOn = !!(process.env.VOBIZ_WA_CHANNEL_ID && process.env.VOBIZ_WA_WABA_ID && process.env.VOBIZ_AUTH_TOKEN);
  const appUrl = process.env.APP_URL ?? "";

  const zoho = await zohoConnection(business.id).catch(() => null);
  const zohoMessage: Record<string, string> = {
    connected: "✅ Zoho Desk connected. New tickets from calls are created there.",
    disconnected: "Zoho Desk disconnected. New tickets use DealerVoice numbers.",
    error: "Couldn't connect Zoho Desk. Please try again.",
    not_configured: "Zoho Desk isn't available yet. Ask the DealerVoice team.",
  };

  const card = "space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";
  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="API & Integrations" description="Every connected account and key in one place. Keys are stored securely and only the last 4 characters are ever shown." />

        <section className={card}>
          <h2 className="font-semibold text-slate-900">Connected services</h2>

          <ConnectDograhForm agentName={business.agent_name} ownKeyEnding={ending(secrets?.dograh_api_key)} agentId={business.dograh_workflow_id} />

          <div className="border-t border-slate-200 pt-4">
            <CalendarForm eventId={business.cal_event_type_id} keyEnding={ending(secrets?.cal_api_key)} />
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4 border-t border-slate-200 pt-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">Zoho Desk (support tickets)</p>
              <p className="text-xs text-slate-500">Tickets from calls are created in your Zoho Desk, and customers are given Zoho&apos;s ticket number. Status changes made in Zoho show up here.</p>
              {zohoResult && zohoMessage[zohoResult] && <p className="mt-1 text-xs font-medium text-slate-700">{zohoMessage[zohoResult]}</p>}
            </div>
            {zoho ? (
              <div className="flex items-center gap-2">
                <Badge tone="emerald" dot>Connected</Badge>
                <form action="/api/zoho/disconnect" method="post">
                  <button className="text-xs text-slate-500 hover:text-red-600">Disconnect</button>
                </form>
              </div>
            ) : (
              <a href="/api/zoho/connect" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">Connect Zoho Desk</a>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 border-t border-slate-200 pt-4">
            <div>
              <p className="text-sm font-medium text-slate-900">WhatsApp confirmations</p>
              <p className="text-xs text-slate-500">Booking confirmations on WhatsApp from your business number. Set up by the DealerVoice team.</p>
            </div>
            {whatsappOn ? (
              <Badge tone="emerald" dot>Connected</Badge>
            ) : (
              <Badge tone="slate">Not connected</Badge>
            )}
          </div>
        </section>

        <ApiKeyPanel
          hint={secrets?.api_key_hint ?? null}
          createdAt={secrets?.api_key_created_at ? formatDateTime(secrets.api_key_created_at) : null}
        />

        <DeveloperDocs appUrl={appUrl} />

        <WebhookForm url={business.webhook_url ?? ""} secret={secrets?.webhook_secret ?? null} />
      </div>
    </main>
  );
}
