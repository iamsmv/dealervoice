import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { zohoAuthUrl, zohoConfigured } from "@/lib/zoho";

// "Connect Zoho Desk": sends the signed-in owner to Zoho to approve access for their dealership.
export async function GET() {
  const back = `${process.env.APP_URL}/dashboard/integrations`;
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id").maybeSingle();
  if (!business) return NextResponse.redirect(`${process.env.APP_URL}/login`);
  if (!zohoConfigured()) return NextResponse.redirect(`${back}?zoho=not_configured`);
  return NextResponse.redirect(zohoAuthUrl(business.id));
}
