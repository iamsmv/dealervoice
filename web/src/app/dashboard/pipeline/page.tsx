import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listBusinessCalls } from "@/lib/agent-roles";
import { STAGES, syncLeadsFromCalls } from "@/lib/leads";
import { formatDateTime, formatPhone } from "@/lib/format";
import { PageHeader } from "../ui";
import { PipelineBoard, type BoardLead } from "./board";

export default async function PipelinePage() {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, dograh_workflow_id").maybeSingle();
  if (!business) redirect("/dashboard");

  // Same as the Leads page: pick up anyone who has phoned since the last visit.
  if (business.dograh_workflow_id) {
    await listBusinessCalls(business)
      .then((calls) => syncLeadsFromCalls(business.id, calls))
      .catch((err) => console.error("Lead sync failed:", err));
  }

  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, phone, car_interest, stage, last_contact_at")
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .limit(500);

  const cards: BoardLead[] = (leads ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    phone: formatPhone(l.phone),
    carInterest: l.car_interest,
    stage: l.stage,
    lastContact: formatDateTime(l.last_contact_at),
  }));
  const open = cards.filter((c) => c.stage !== "sold" && c.stage !== "lost").length;

  return (
    <main className="px-4 py-8 md:px-8">
      <PageHeader
        title="Pipeline"
        count={open}
        description={<>Drag a lead to move it to the next stage (or use the menu on each card). {open} open {open === 1 ? "lead" : "leads"}.</>}
      />
      <div className="mt-6">
        <PipelineBoard leads={cards} stages={STAGES} />
      </div>
    </main>
  );
}
