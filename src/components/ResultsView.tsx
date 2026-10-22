"use client";

import { useMemo, useState } from "react";
import { download, toCsv, toHubSpotCsv } from "@/lib/exporters";
import type { Lead, Tier } from "@/lib/types";
import { Chip, cx, EmailBadge, ScoreRing, TierBadge } from "./ui";

interface Props {
  leads: Lead[];
  pending: string[];
  total: number;
  duplicates: number;
  invalid: number;
  onOpen: (lead: Lead) => void;
}

type TierFilter = "all" | Tier;

export function ResultsView({ leads, pending, total, duplicates, invalid, onOpen }: Props) {
  const [tier, setTier] = useState<TierFilter>("all");
  const [query, setQuery] = useState("");
  const [needEmail, setNeedEmail] = useState(false);
  const [needPerson, setNeedPerson] = useState(false);

  const sorted = useMemo(() => [...leads].sort((a, b) => b.score.final - a.score.final), [leads]);
  const visible = sorted.filter((l) => {
    if (tier !== "all" && l.tier !== tier) return false;
    if (needEmail && !l.emails.some((e) => !e.guessed && e.confidence !== "low")) return false;
    if (needPerson && l.people.length === 0) return false;
    if (query) {
      const q = query.toLowerCase();
      const hay = `${l.name} ${l.domain} ${l.description} ${l.location ?? ""} ${l.signals.map((s) => s.label).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const counts = {
    hot: leads.filter((l) => l.tier === "hot").length,
    warm: leads.filter((l) => l.tier === "warm").length,
    cold: leads.filter((l) => l.tier === "cold").length,
  };
  const directEmails = leads.filter((l) => l.emails.some((e) => e.confidence === "high")).length;
  const done = leads.length;
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>
              Qualifying… <span className="font-mono">{pending.slice(0, 3).join(", ")}</span>
            </span>
            <span className="tabular-nums">
              {done}/{total}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Hot leads" value={counts.hot} tone="text-rose-600 dark:text-rose-400" hint="Call these first" />
        <Kpi label="Warm" value={counts.warm} tone="text-amber-600 dark:text-amber-400" hint="Nurture / sequence" />
        <Kpi label="Direct emails" value={directEmails} tone="text-emerald-600 dark:text-emerald-400" hint="Named inbox, domain verified" />
        <Kpi
          label="Cleaned out"
          value={duplicates + invalid + counts.cold}
          tone="text-slate-600 dark:text-slate-300"
          hint={`${duplicates} dupes · ${invalid} invalid · ${counts.cold} cold`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-900">
          {(["all", "hot", "warm", "cold"] as TierFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={cx("rounded-md px-2.5 py-1 capitalize", tier === t ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}
            >
              {t}
              {t !== "all" && <span className="ml-1 opacity-60">{counts[t]}</span>}
            </button>
          ))}
        </div>
        <Toggle on={needEmail} onClick={() => setNeedEmail(!needEmail)}>
          Has email
        </Toggle>
        <Toggle on={needPerson} onClick={() => setNeedPerson(!needPerson)}>
          Decision maker found
        </Toggle>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, signal, city…"
          className="min-w-40 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!visible.length}
            onClick={() => download(`leads-${stamp}.csv`, toCsv(visible))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            Export CSV
          </button>
          <button
            type="button"
            disabled={!visible.length}
            onClick={() => download(`hubspot-import-${stamp}.csv`, toHubSpotCsv(visible))}
            className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-40"
          >
            HubSpot import
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {visible.map((lead) => (
            <LeadRow key={lead.id} lead={lead} onOpen={() => onOpen(lead)} />
          ))}
          {pending.map((d) => (
            <li key={d} className="flex animate-pulse items-center gap-4 px-4 py-3">
              <div className="h-11 w-11 rounded-full bg-slate-100 dark:bg-slate-800" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-40 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="font-mono text-xs text-slate-400">{d}</div>
              </div>
            </li>
          ))}
          {visible.length === 0 && pending.length === 0 && <li className="p-8 text-center text-sm text-slate-500">No leads match these filters.</li>}
        </ul>
      </div>
    </div>
  );
}

function LeadRow({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const email = lead.emails.find((e) => !e.guessed) ?? lead.emails[0];
  const person = lead.people[0];
  const highlights = lead.signals.filter((s) => s.kind === "opportunity" || s.kind === "fit").slice(0, 3);
  const risk = lead.signals.find((s) => s.kind === "risk");

  return (
    <li>
      <button type="button" onClick={onOpen} className="grid w-full text-slate-900 dark:text-slate-100 grid-cols-[auto_1fr] items-center gap-4 px-4 py-3 text-left transition hover:bg-slate-50 md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1.3fr)_auto] dark:hover:bg-slate-800/50">
        <ScoreRing score={lead.score.final} tier={lead.tier} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-slate-900 dark:text-slate-50">{lead.name}</span>
            <TierBadge tier={lead.tier} />
            {lead.fromCache && <span className="text-[10px] uppercase tracking-wide text-slate-400">cached</span>}
          </div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
            {lead.domain}
            {lead.location && ` · ${lead.location}`}
            {lead.foundedYear && ` · since ${lead.foundedYear}`}
          </div>
          {lead.description && <p className="mt-0.5 line-clamp-1 text-sm text-slate-600 dark:text-slate-300">{lead.description}</p>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {highlights.map((s) => (
              <Chip key={s.label} tone={s.kind === "opportunity" ? "accent" : "good"}>
                {s.label}
              </Chip>
            ))}
            {risk && <Chip tone="bad">{risk.label}</Chip>}
            {!lead.reachable && <Chip tone="bad">{lead.blockedReason ?? "Unreachable"}</Chip>}
          </div>
        </div>
        <div className="col-span-2 min-w-0 space-y-1 text-sm md:col-span-1">
          {person ? (
            <div className="truncate">
              <span className="font-medium">{person.name}</span> <span className="text-xs text-slate-500">· {person.title}</span>
            </div>
          ) : (
            <div className="text-xs text-slate-400">No decision maker found</div>
          )}
          {email && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs">{email.address}</span>
              <EmailBadge email={email} />
            </div>
          )}
          {lead.phones[0] && <div className="font-mono text-xs text-slate-500">{lead.phones[0]}</div>}
        </div>
        <span className="hidden text-slate-300 md:block dark:text-slate-600">›</span>
      </button>
    </li>
  );
}

function Kpi({ label, value, tone, hint }: { label: string; value: number; tone: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className={cx("text-2xl font-bold tabular-nums", tone)}>{value}</div>
      <div className="truncate text-[11px] text-slate-400">{hint}</div>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
        on ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
      )}
    >
      {on ? "✓ " : ""}
      {children}
    </button>
  );
}
