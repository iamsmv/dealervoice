import { normalisePhone } from "@/lib/phone";

// Minimal CSV reader: commas or semicolons, quoted fields with "" escapes, any line ending.
export function parseCsv(text: string): string[][] {
  // Count separators in the header outside quotes, so "Name, Surname";Phone is read as semicolon-separated.
  const header = text.split(/\r?\n/)[0].replace(/"[^"]*"/g, "");
  const delimiter = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

export type ImportedContact = { name: string | null; phone: string; car_interest: string | null };

// Finds the name / phone / car columns by their header (or guesses the phone column if there's no header)
// and returns valid, de-duplicated contacts plus how many rows were skipped.
export function contactsFromCsv(text: string, max: number): { contacts: ImportedContact[]; skipped: number; error?: string } {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return { contacts: [], skipped: 0, error: "The file is empty." };

  const header = rows[0].map((h) => h.toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  // Prefer an explicit phone column, so "invoice number" etc. isn't mistaken for it.
  let phoneCol = find(/phone|mobile|whatsapp/);
  if (phoneCol < 0) phoneCol = find(/number|contact/);
  const hasHeader = phoneCol >= 0;
  if (!hasHeader) phoneCol = rows[0].findIndex((c) => normalisePhone(c));
  if (phoneCol < 0) return { contacts: [], skipped: 0, error: "Couldn't find a phone number column. Name it \"phone\"." };
  const nameCol = hasHeader ? find(/name/) : rows[0].findIndex((c, i) => i !== phoneCol && /[a-z]/i.test(c));
  const carCol = hasHeader ? find(/car|model|vehicle|interest/) : -1;

  const seen = new Set<string>();
  const contacts: ImportedContact[] = [];
  let skipped = 0;
  for (const r of rows.slice(hasHeader ? 1 : 0)) {
    const phone = normalisePhone(r[phoneCol] ?? "");
    if (!phone || seen.has(phone) || contacts.length >= max) { skipped++; continue; }
    seen.add(phone);
    contacts.push({
      phone,
      name: (nameCol >= 0 ? r[nameCol] : "")?.slice(0, 80) || null,
      car_interest: (carCol >= 0 ? r[carCol] : "")?.slice(0, 60) || null,
    });
  }
  return { contacts, skipped };
}

export type PaymentContact = { name: string; phone: string; amount: number; due_date: string; reference: string | null };

// Payment reminder list: name, phone, amount, due_date, optional reference (EMI / invoice / job card).
// Rows missing any required value are skipped; a header row is required so amounts aren't guessed.
export function paymentsFromCsv(text: string, max: number): { contacts: PaymentContact[]; skipped: number; error?: string } {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return { contacts: [], skipped: 0, error: "The file is empty." };
  const header = rows[0].map((h) => h.toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  let phoneCol = find(/phone|mobile|whatsapp/);
  if (phoneCol < 0) phoneCol = find(/^(number|contact)/);
  const nameCol = find(/name/);
  const amountCol = find(/amount|balance|outstanding/);
  let dueCol = find(/date/);
  if (dueCol < 0) dueCol = header.findIndex((h, i) => i !== amountCol && /due/.test(h));
  const refCol = header.findIndex((h, i) => i !== amountCol && i !== dueCol && i !== nameCol && /ref|invoice|emi|loan|job|account/.test(h));
  const missing = [phoneCol < 0 && "phone", nameCol < 0 && "name", amountCol < 0 && "amount", dueCol < 0 && "due_date"].filter(Boolean);
  if (missing.length) return { contacts: [], skipped: 0, error: `Missing column(s): ${missing.join(", ")}. Download the sample to see the layout.` };

  const seen = new Set<string>();
  const contacts: PaymentContact[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const phone = normalisePhone(r[phoneCol] ?? "");
    const name = (r[nameCol] ?? "").slice(0, 80);
    // Accept "12,500", "₹12,500", "Rs. 12500", "INR 12500"; anything else (e.g. "-500") is skipped.
    const amount = Number((r[amountCol] ?? "").replace(/₹|rs\.?|inr|[,\s]/gi, ""));
    const due_date = (r[dueCol] ?? "").slice(0, 40);
    if (!phone || !name || !Number.isFinite(amount) || !(amount > 0) || !due_date || seen.has(phone) || contacts.length >= max) { skipped++; continue; }
    seen.add(phone);
    contacts.push({ phone, name, amount, due_date, reference: (refCol >= 0 ? r[refCol] : "")?.slice(0, 40) || null });
  }
  return { contacts, skipped };
}
