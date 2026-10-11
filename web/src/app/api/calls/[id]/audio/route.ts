import { createClient } from "@/lib/supabase/server";
import { elevenLabsCallAudio, getElevenLabsCall } from "@/lib/elevenlabs-conversations";

// Plays an ElevenLabs call recording in the dashboard. Signed-in owners only, and only their own dealership's
// calls; the ElevenLabs key stays on the server.
export async function GET(_request: Request, { params }: RouteContext<"/api/calls/[id]/audio">) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id").maybeSingle();
  if (!business) return new Response("Not found", { status: 404 });
  if (!(await getElevenLabsCall(business.id, id))) return new Response("Not found", { status: 404 });

  const audio = await elevenLabsCallAudio(id);
  if (!audio.ok || !audio.body) return new Response("Recording not available", { status: 502 });
  return new Response(audio.body, {
    headers: { "Content-Type": audio.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "private, max-age=3600" },
  });
}
