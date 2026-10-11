import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { disconnectZoho } from "@/lib/zoho";

// Stops using Zoho Desk: new tickets get our own numbers again. Existing Zoho tickets are left as they are.
export async function POST() {
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id").maybeSingle();
  if (!business) return NextResponse.redirect(`${process.env.APP_URL}/login`, 303);
  await disconnectZoho(business.id);
  return NextResponse.redirect(`${process.env.APP_URL}/dashboard/integrations?zoho=disconnected`, 303);
}
