import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { businessFromState, connectZoho } from "@/lib/zoho";

// Zoho sends the owner back here after they approve. The signed state must match the signed-in dealership.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = `${process.env.APP_URL}/dashboard/integrations`;
  const code = url.searchParams.get("code");
  const stateBusiness = businessFromState(url.searchParams.get("state") ?? "");
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id").maybeSingle();
  if (!code || !stateBusiness || !business || business.id !== stateBusiness) return NextResponse.redirect(`${back}?zoho=error`);
  try {
    await connectZoho(business.id, code);
  } catch (err) {
    console.error("Zoho connect failed:", err);
    return NextResponse.redirect(`${back}?zoho=error`);
  }
  return NextResponse.redirect(`${back}?zoho=connected`);
}
