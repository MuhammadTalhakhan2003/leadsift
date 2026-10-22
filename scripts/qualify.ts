// Qualify a whole list from the terminal, no UI needed:
//
//   npm run qualify -- leads.csv --industries hvac,plumbing --min-years 15
//   npm run qualify -- domains.txt --preset sales --locations texas --hubspot
//
// Reads any CSV export (SaaSquatch, Apollo, CRM) or a plain list of websites, runs the
// same pipeline as the web app, prints a ranked table and writes ranked CSV(s).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { aiModel, aiProvider } from "../src/lib/ai";
import { cacheBackend } from "../src/lib/cache";
import { parseCsvInput, toCsv, toHubSpotCsv } from "../src/lib/exporters";
import { dedupeRows } from "../src/lib/normalize";
import { qualifyDomain } from "../src/lib/pipeline";
import { PRESETS } from "../src/lib/presets";
import type { Icp, Lead, PresetId } from "../src/lib/types";

const HELP = `Usage: npm run qualify -- <file.csv|file.txt> [options]

Options:
  --preset <acquisition|sales>   Who counts as a good lead (default: acquisition)
  --industries <a,b,c>           Industry keywords to match
  --locations <a,b>              Location keywords (state codes match the address only)
  --min-years <n>                Minimum years in business (default: preset default)
  --out <file.csv>               Ranked output (default: <input>-ranked.csv)
  --hubspot                      Also write a HubSpot import CSV
  --concurrency <n>              Parallel companies (default: 4, or 2 with Groq's free tier)
  --help                         Show this help

Environment (.env.local is loaded automatically):
  GROQ_API_KEY       Free AI scoring via Groq (https://console.groq.com/keys)
  ANTHROPIC_API_KEY  AI scoring via Claude
  DATABASE_URL       Optional Postgres cache shared with the web app`;

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    preset: { type: "string", default: "acquisition" },
    industries: { type: "string", default: "" },
    locations: { type: "string", default: "" },
    "min-years": { type: "string" },
    out: { type: "string" },
    hubspot: { type: "boolean", default: false },
    concurrency: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const inputPath = positionals[0];
if (!existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}
if (!(values.preset in PRESETS)) {
  console.error(`Unknown preset "${values.preset}". Use acquisition or sales.`);
  process.exit(1);
}

const preset = values.preset as PresetId;
const list = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const icp: Icp = {
  preset,
  industries: list(values.industries),
  locations: list(values.locations),
  minYears: values["min-years"] !== undefined ? Number(values["min-years"]) : PRESETS[preset].defaults.minYears,
};
const model = aiModel();
// Groq's free tier has a low tokens-per-minute cap, so go easier on it.
const concurrency = Number(values.concurrency) || (aiProvider() === "groq" ? 2 : 4);
const base = inputPath.replace(/\.[^.]+$/, "");
const outPath = values.out ?? `${base}-ranked.csv`;

async function main() {
  const { rows, duplicates, invalid } = dedupeRows(parseCsvInput(readFileSync(inputPath, "utf8")));
  if (rows.length === 0) {
    console.error("No websites found in the input file.");
    process.exit(1);
  }

  console.log(`\nLeadSift: ${rows.length} companies (${duplicates} duplicates, ${invalid} invalid rows removed)`);
  console.log(`ICP: ${PRESETS[preset].label} · industries: ${icp.industries.join(", ") || "any"} · locations: ${icp.locations.join(", ") || "any"} · ${icp.minYears}+ years`);
  console.log(`AI: ${model ?? "off (rules-only)"} · cache: ${cacheBackend()} · concurrency: ${concurrency}\n`);

  const started = Date.now();
  const leads: Lead[] = [];
  const queue = [...rows];
  let done = 0;

  const worker = async () => {
    while (queue.length) {
      const row = queue.shift()!;
      let lead: Lead;
      try {
        lead = await qualifyDomain(row.domain, icp, row.name);
      } catch (err) {
        console.error(`  ! ${row.domain}: ${err instanceof Error ? err.message : err}`);
        continue;
      }
      leads.push(lead);
      done++;
      const status = lead.reachable ? `${String(lead.score.final).padStart(3)} ${lead.tier.padEnd(4)}` : `  - ${lead.blockedReason}`;
      console.log(`  [${String(done).padStart(String(rows.length).length)}/${rows.length}] ${lead.domain.padEnd(32)} ${status}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));

  leads.sort((a, b) => b.score.final - a.score.final);
  writeFileSync(outPath, toCsv(leads));
  if (values.hubspot) writeFileSync(`${base}-hubspot.csv`, toHubSpotCsv(leads));

  const count = (t: string) => leads.filter((l) => l.tier === t).length;
  console.log(`\nTop leads:`);
  console.table(
    leads.slice(0, 10).map((l) => ({
      score: l.score.final,
      tier: l.tier,
      company: l.name.slice(0, 34),
      contact: (l.people[0]?.name ?? l.emails.find((e) => !e.guessed)?.address ?? l.phones[0] ?? "").slice(0, 34),
      why: l.signals.filter((s) => s.kind !== "risk").slice(0, 2).map((s) => s.label).join("; ").slice(0, 60),
    })),
  );
  console.log(`Hot ${count("hot")} · Warm ${count("warm")} · Cold ${count("cold")} · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`Wrote ${path.resolve(outPath)}`);
  if (values.hubspot) console.log(`Wrote ${path.resolve(`${base}-hubspot.csv`)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
