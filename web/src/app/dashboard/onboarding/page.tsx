import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id").maybeSingle();
  if (business) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold text-slate-900">Set up your AI receptionist</h1>
        <p className="mt-2 text-slate-600">Takes about 3 minutes. You can change everything later.</p>
        <div className="mt-8">
          <OnboardingForm />
        </div>
      </div>
    </main>
  );
}
