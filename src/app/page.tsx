"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LeadDrawer } from "@/components/LeadDrawer";
import { ResultsView } from "@/components/ResultsView";
import { SetupPanel } from "@/components/SetupPanel";
import { parseCsvInput } from "@/lib/exporters";
import { dedupeRows, type InputRow } from "@/lib/normalize";
import { SAMPLE } from "@/lib/samples";
import type { Icp, Lead } from "@/lib/types";

const CONCURRENCY = 4;
const STORAGE_KEY = "leadsift:last-run";

interface RunState {
  leads: Lead[];
  pending: string[];
  total: number;
  duplicates: number;
  invalid: number;
}

const EMPTY_RUN: RunState = { leads: [], pending: [], total: 0, duplicates: 0, invalid: 0 };

export default function Home() {
  const [icp, setIcp] = useState<Icp>({ preset: "acquisition", industries: [], locations: [], minYears: 15 });
  const [input, setInput] = useState("");
  const [csvRows, setCsvRows] = useState<{ raw: string; name?: string }[] | null>(null);
  const [csvLabel, setCsvLabel] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>(EMPTY_RUN);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<Lead | null>(null);
  const [status, setStatus] = useState<{ ai: boolean; provider: "claude" | "groq" | null; model: string | null; cache: string } | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the previous session once on mount
      if (saved) setRun({ ...EMPTY_RUN, ...JSON.parse(saved), pending: [] });
    } catch {
      // Storage unavailable (private mode): start fresh.
    }
  }, []);

  useEffect(() => {
    if (running) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...run, pending: [] }));
    } catch {
      // Ignore quota / private-mode errors; persistence is a convenience only.
    }
  }, [run, running]);

  const handleCsv = async (file: File) => {
    const rows = parseCsvInput(await file.text());
    if (rows.length === 0) {
      setCsvRows(null);
      setCsvLabel(`${file.name}: no websites found. Check that it has a Website/Domain/URL column.`);
      return;
    }
    setCsvRows(rows);
    setCsvLabel(`${file.name}: ${rows.length} rows`);
    setInput(rows.map((r) => (r.name ? `${r.raw}, ${r.name}` : r.raw)).join("\n"));
  };

  const runAll = useCallback(async () => {
    const source =
      csvRows ??
      input
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [raw, ...name] = line.split(",");
          return { raw: raw.trim(), name: name.join(",").trim() || undefined };
        });
    const { rows, duplicates, invalid } = dedupeRows(source);
    if (!rows.length) return;

    stopRef.current = false;
    setRunning(true);
    setRun({ leads: [], pending: rows.map((r) => r.domain), total: rows.length, duplicates, invalid });

    const queue: InputRow[] = [...rows];
    const worker = async () => {
      while (queue.length && !stopRef.current) {
        const row = queue.shift()!;
        let lead: Lead;
        try {
          const res = await fetch("/api/qualify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain: row.domain, name: row.name, icp }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          lead = await res.json();
        } catch (err) {
          lead = failedLead(row, err instanceof Error ? err.message : "Request failed");
        }
        setRun((r) => ({ ...r, leads: [...r.leads, lead], pending: r.pending.filter((d) => d !== row.domain) }));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRun((r) => ({ ...r, pending: [] }));
    setRunning(false);
  }, [csvRows, input, icp]);

  const hasResults = run.leads.length > 0 || run.pending.length > 0;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-[57px] items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm font-black text-white">LS</div>
          <div>
            <div className="text-sm font-bold leading-tight">LeadSift</div>
            <div className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">Qualify and prioritize leads before you reach out</div>
          </div>
        </div>
        {status && (
          <div className="hidden items-center gap-2 text-[11px] sm:flex">
            <span className={`rounded-full px-2 py-0.5 ${status.ai ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>
              {status.ai ? `● AI scoring: ${status.provider === "groq" ? "Groq" : "Claude"}` : "○ Rules-only scoring"}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 dark:bg-slate-800">cache: {status.cache}</span>
          </div>
        )}
      </header>

      <div className="grid lg:grid-cols-[380px_1fr]">
        <SetupPanel
          icp={icp}
          onIcpChange={setIcp}
          input={input}
          onInputChange={(v) => {
            setInput(v);
            setCsvRows(null);
            setCsvLabel(null);
          }}
          onCsv={handleCsv}
          onSample={() => {
            setIcp(SAMPLE.icp);
            setInput(SAMPLE.domains.join("\n"));
            setCsvRows(null);
            setCsvLabel(null);
          }}
          onRun={runAll}
          onStop={() => (stopRef.current = true)}
          running={running}
          queued={run.pending.length}
          csvLabel={csvLabel}
        />

        <main className="min-w-0 p-5">
          {hasResults ? (
            <ResultsView leads={run.leads} pending={run.pending} total={run.total} duplicates={run.duplicates} invalid={run.invalid} onOpen={setOpen} />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>

      <LeadDrawer lead={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function EmptyState() {
  const steps = [
    ["Define your ideal lead", "Pick acquisition targets or sales prospects, then add industries, locations and minimum age."],
    ["Drop in a list", "Paste websites or upload any CSV export, such as SaaSquatch, Apollo or your CRM. Duplicates and junk rows are removed."],
    ["Work the hot list", "Every lead is scored 0-100 with the evidence behind it, verified contacts and a suggested opener. Export to CSV or HubSpot."],
  ];
  return (
    <div className="mx-auto max-w-2xl py-10">
      <h1 className="text-2xl font-bold tracking-tight">Stop cold-calling a raw list.</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">
        Scraped lead lists are long and noisy. LeadSift reads each company&apos;s website, checks who you can actually reach, and ranks every lead against <em>your</em> ideal profile, so the first hour of outreach goes to the best ten companies, not the first ten.
      </p>
      <ol className="mt-8 space-y-4">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">{i + 1}</span>
            <div>
              <div className="font-semibold">{title}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">{body}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-slate-500">
        Tip: click <strong>Load sample list</strong> on the left to see it in action.
      </p>
    </div>
  );
}

function failedLead(row: InputRow, error: string): Lead {
  return {
    id: row.domain, domain: row.domain, inputName: row.name, name: row.name || row.domain, url: null, reachable: false,
    blockedReason: error, description: "", foundedYear: null, yearsInBusiness: null, location: null, emails: [], phones: [],
    socials: {}, people: [], tech: [], hiring: false, pagesScanned: [], signals: [],
    score: { fit: 0, contact: 0, opportunity: 0, penalties: 0, heuristic: 0, ai: null, final: 0 },
    tier: "cold", ai: null, fromCache: false, durationMs: 0, error,
  };
}
