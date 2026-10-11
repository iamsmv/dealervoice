import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CopyButton } from "./copy-button";
import { PageHeader, card } from "../ui";
import { displayAgentName } from "@/lib/elevenlabs";

export default async function FormsPage() {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, agent_name").maybeSingle();
  if (!business) redirect("/dashboard");
  business.agent_name = await displayAgentName(business);

  const { count } = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("source", "web_form");

  const base = process.env.APP_URL ?? "";
  const link = `${base}/f/${business.id}`;
  const embed = `<iframe src="${link}?embed=1" title="Book a test drive" style="width:100%;max-width:480px;height:620px;border:0"></iframe>`;

  return (
    <main className="px-4 py-8 md:px-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Forms"
          description={
            <>
              A &ldquo;Book a test drive&rdquo; form for your website, ads or WhatsApp. When someone fills it in,{" "}
              {business.agent_name} calls them within a minute (9 AM – 8 PM). <b className="font-semibold text-slate-800">{count ?? 0} leads so far.</b>
            </>
          }
        />

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-6">
            <section className={`${card} p-6`}>
              <h2 className="flex items-center gap-2 font-semibold text-slate-900"><StepNo n={1} /> Share the link</h2>
              <p className="mt-1 text-sm text-slate-500">Paste it in Instagram/Facebook ads, Google Business profile or WhatsApp.</p>
              <div className="mt-3 flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{link}</code>
                <CopyButton text={link} />
              </div>
              <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-indigo-600 hover:underline">
                Open the form ↗
              </a>
            </section>

            <section className={`${card} p-6`}>
              <h2 className="flex items-center gap-2 font-semibold text-slate-900"><StepNo n={2} /> Or put it on your website</h2>
              <p className="mt-1 text-sm text-slate-500">Give this code to whoever manages your website. It shows the form right on the page (light colours; change <code>embed=1</code> to <code>embed=1&amp;theme=dark</code> for a dark website).</p>
              <div className="mt-3 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{embed}</code>
                <CopyButton text={embed} />
              </div>
            </section>

            <section className={`${card} p-6 text-sm text-slate-600`}>
              <h2 className="font-semibold text-slate-900">What happens after someone submits</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>They appear in <strong>Leads</strong> and <strong>Pipeline</strong> with source &ldquo;Website form&rdquo;.</li>
                <li>{business.agent_name} phones them straight away and books the test drive.</li>
                <li>At night, or if we called them in the last 10 minutes, the lead is saved and no call is made.</li>
              </ul>
            </section>
          </div>

          <section className={`${card} min-w-0 p-4`}>
            <h2 className="px-2 pb-2 font-semibold text-slate-900">Preview</h2>
            <iframe src={`/f/${business.id}?embed=1`} title="Form preview" className="h-[620px] w-full rounded-xl border-0" />
          </section>
        </div>
      </div>
    </main>
  );
}

function StepNo({ n }: { n: number }) {
  return <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{n}</span>;
}
