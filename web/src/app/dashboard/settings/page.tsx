import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DetailsForm } from "./settings-forms";
import { PageHeader } from "../ui";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, city, brands, showroom_hours, service_hours, agent_name")
    .maybeSingle();
  if (!business) redirect("/dashboard");

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Settings"
          description={
            <>
              Your dealership details. Calendar, WhatsApp, API keys and webhooks are under{" "}
              <Link href="/dashboard/integrations" className="font-medium text-indigo-600 hover:underline">API &amp; Integrations</Link>.
            </>
          }
        />
        <DetailsForm business={business} />
      </div>
    </main>
  );
}
