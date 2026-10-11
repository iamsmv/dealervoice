import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin-auth";
import { Sidebar } from "./sidebar";
import { extraAgentsEnabled } from "@/lib/agent-roles";
import { displayAgentName } from "@/lib/elevenlabs";

// Dealerships that have finished setup get the CRM sidebar; during onboarding the page renders alone.
export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, name, agent_name, plan").maybeSingle();

  if (!business) return <>{children}</>;
  business.agent_name = await displayAgentName(business);

  if (business.plan === "paused") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-sm font-bold text-indigo-600">DealerVoice</p>
          <h1 className="mt-2 text-xl font-bold text-slate-900">Your account is paused</h1>
          <p className="mt-2 text-sm text-slate-600">
            The dashboard and outbound calls for {business.name} are on hold. Please contact the DealerVoice team to reactivate your account.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 md:flex-row">
      <Sidebar businessName={business.name} agentName={business.agent_name} showAdmin={await isAdmin()} showSupport={await extraAgentsEnabled(business.id)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
