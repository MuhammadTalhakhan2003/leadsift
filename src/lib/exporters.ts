// CSV exports shaped for where leads go next: a spreadsheet, or a CRM import.

import Papa from "papaparse";
import type { Lead } from "./types";

function bestEmail(l: Lead) {
  return l.emails.find((e) => !e.guessed) ?? l.emails[0];
}

export function toCsv(leads: Lead[]): string {
  return Papa.unparse(
    leads.map((l) => {
      const email = bestEmail(l);
      return {
        Company: l.name,
        Domain: l.domain,
        Tier: l.tier,
        Score: l.score.final,
        Summary: l.description,
        "Decision maker": l.people[0]?.name ?? "",
        Title: l.people[0]?.title ?? "",
        Email: email?.address ?? "",
        "Email confidence": email ? `${email.confidence}${email.guessed ? " (guessed)" : ""}` : "",
        Phone: l.phones[0] ?? "",
        LinkedIn: l.socials.linkedin ?? "",
        Founded: l.foundedYear ?? "",
        Location: l.location ?? "",
        "Why it ranks": l.signals.filter((s) => s.kind !== "risk").map((s) => s.label).join("; "),
        Risks: [...l.signals.filter((s) => s.kind === "risk").map((s) => s.label), ...(l.ai?.risks ?? [])].join("; "),
        "Suggested opener": l.ai?.outreachOpener ?? "",
      };
    }),
  );
}

/** Column names match HubSpot's default import properties so mapping is automatic. */
export function toHubSpotCsv(leads: Lead[]): string {
  return Papa.unparse(
    leads.map((l) => {
      const email = bestEmail(l);
      const [first, ...rest] = (l.people[0]?.name ?? "").split(" ");
      return {
        "Company name": l.name,
        "Company Domain Name": l.domain,
        "Phone Number": l.phones[0] ?? "",
        City: l.location?.split(",")[0] ?? "",
        "State/Region": l.location?.split(",")[1]?.trim() ?? "",
        "Year Founded": l.foundedYear ?? "",
        "LinkedIn Company Page": l.socials.linkedin ?? "",
        "First Name": first ?? "",
        "Last Name": rest.join(" "),
        "Job Title": l.people[0]?.title ?? "",
        Email: email && !email.guessed ? email.address : "",
        "Lead Status": l.tier === "hot" ? "OPEN" : l.tier === "warm" ? "NEW" : "UNQUALIFIED",
        "Lead Score": l.score.final,
        Notes: [l.description, l.ai?.outreachOpener].filter(Boolean).join(" | "),
      };
    }),
  );
}

export function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads a SaaSquatch / CRM / spreadsheet export and finds the website + name columns. */
export function parseCsvInput(text: string): { raw: string; name?: string }[] {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields ?? [];
  const domainCol = fields.find((f) => /website|domain|url|site/i.test(f));
  const nameCol = fields.find((f) => /company|business|name|organization/i.test(f) && f !== domainCol);
  if (domainCol) {
    return parsed.data
      .map((row) => ({ raw: row[domainCol] ?? "", name: nameCol ? row[nameCol] : undefined }))
      .filter((r) => r.raw);
  }
  // No header we recognise: treat every cell that looks like a domain as one.
  return text
    .split(/[\n,;\t]+/)
    .map((s) => s.trim())
    .filter((s) => /\.[a-z]{2,}/i.test(s))
    .map((raw) => ({ raw }));
}
