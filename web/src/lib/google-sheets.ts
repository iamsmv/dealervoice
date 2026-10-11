import "server-only";

// Reads a Google Sheet as CSV from its normal share link, so owners don't have to download and upload a file.
// The sheet must be shared as "Anyone with the link → Viewer". Only docs.google.com links are fetched.

const MAX_BYTES = 1_000_000;

export function parseSheetUrl(raw: string): { id: string; gid: string } | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
    const id = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)?.[1];
    if (!id) return null;
    // The tab is in "#gid=123" (or "?gid=123"); default is the first tab.
    const gid = url.hash.match(/gid=(\d+)/)?.[1] ?? url.searchParams.get("gid") ?? "0";
    return { id, gid: /^\d+$/.test(gid) ? gid : "0" };
  } catch {
    return null;
  }
}

export async function fetchSheetCsv(raw: string): Promise<{ text: string } | { error: string }> {
  const sheet = parseSheetUrl(raw);
  if (!sheet) return { error: "That doesn't look like a Google Sheets link. Copy it from the browser address bar (it starts with https://docs.google.com/spreadsheets/…)." };
  let res: Response;
  try {
    res = await fetch(`https://docs.google.com/spreadsheets/d/${sheet.id}/export?format=csv&gid=${sheet.gid}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { error: "Couldn't reach Google Sheets. Please try again." };
  }
  const notShared = "We can't open this sheet. In Google Sheets click Share → General access → “Anyone with the link” → Viewer, then try again.";
  if (res.status === 401 || res.status === 403 || res.status === 404) return { error: notShared };
  if (!res.ok) return { error: `Google Sheets returned an error (${res.status}). Please try again.` };
  // A private sheet answers with Google's sign-in page instead of CSV.
  if ((res.headers.get("content-type") ?? "").includes("text/html")) return { error: notShared };
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return { error: "That sheet is too big (max about 20,000 rows)." };
  const text = await res.text();
  if (text.length > MAX_BYTES) return { error: "That sheet is too big (max about 20,000 rows)." };
  if (!text.trim()) return { error: "That sheet tab is empty." };
  return { text };
}
