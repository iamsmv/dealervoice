import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { TestDriveForm } from "./test-drive-form";
import { EmbedTheme } from "./embed-theme";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadDealership(id: string) {
  if (!UUID.test(id)) return null;
  // Public page: read only the fields a customer should see.
  const { data } = await createAdminClient()
    .from("businesses")
    .select("id, name, city, brands, agent_name")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: PageProps<"/f/[id]">): Promise<Metadata> {
  const dealership = await loadDealership((await params).id);
  return { title: dealership ? `Book a test drive – ${dealership.name}` : "Book a test drive" };
}

// Public "Book a test drive" page. ?embed=1 is for iframes on the dealership's own website:
// no outer card, and light colours unless &theme=dark.
export default async function TestDrivePage({ params, searchParams }: PageProps<"/f/[id]">) {
  const { id } = await params;
  const { embed, theme } = (await searchParams) as Record<string, string | undefined>;
  const dealership = await loadDealership(id);
  if (!dealership) notFound();

  return (
    <main className={embed ? "bg-white p-4" : "flex min-h-screen items-start justify-center bg-slate-50 px-4 py-10 sm:items-center"}>
      {embed && <EmbedTheme theme={theme === "dark" ? "dark" : "light"} />}
      <div className={embed ? "" : "w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"}>
        <p className="text-sm font-medium text-indigo-600">{dealership.name}{dealership.city ? ` · ${dealership.city}` : ""}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">🚗 Book a test drive</h1>
        <p className="mb-5 mt-1 text-sm text-slate-600">Leave your number and we&apos;ll call you right away to pick a time.</p>
        <TestDriveForm
          businessId={dealership.id}
          dealershipName={dealership.name}
          agentName={dealership.agent_name}
          brands={dealership.brands}
        />
      </div>
    </main>
  );
}
