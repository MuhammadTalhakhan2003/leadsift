"use client";

import { useEffect, useState } from "react";
import type { Lead } from "@/lib/types";
import { Chip, cx, EmailBadge, ScoreRing, TierBadge } from "./ui";

export function LeadDrawer({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!lead) return null;
  const s = lead.score;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={lead.name}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px]" />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl dark:bg-slate-900">
        <header className="sticky top-0 z-10 flex items-start gap-4 border-b border-slate-200 bg-white/95 p-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <ScoreRing score={s.final} tier={lead.tier} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{lead.name}</h2>
              <TierBadge tier={lead.tier} />
            </div>
            <a href={lead.url ?? `https://${lead.domain}`} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
              {lead.domain} ↗
            </a>
            {lead.description && <p className="mt-1 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">{lead.description}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="space-y-6 p-5">
          {!lead.reachable && (
            <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              Could not read this website: {lead.blockedReason}. We don&apos;t bypass CAPTCHAs or bot walls; try the company&apos;s other domain or check it manually.
            </div>
          )}

          {lead.ai?.outreachOpener && <Opener text={lead.ai.outreachOpener} />}

          <Section title="Why this score">
            <div className="space-y-2">
              <Bar label="ICP fit" value={s.fit} max={40} />
              <Bar label="Reachability" value={s.contact} max={30} />
              <Bar label="Opportunity signals" value={s.opportunity} max={30} />
              {s.penalties < 0 && <div className="text-xs text-rose-600 dark:text-rose-400">Risk deductions: {s.penalties}</div>}
              <div className="pt-1 text-xs text-slate-500 dark:text-slate-400">
                Rules score {s.heuristic}
                {s.ai !== null
                  ? ` · AI fit score ${s.ai} (${lead.ai?.model ?? "AI"}) · blended ${s.final}`
                  : " · add a Groq (free) or Anthropic key to blend in AI judgement"}
              </div>
            </div>
            <ul className="mt-3 space-y-1.5">
              {lead.signals.map((sig) => (
                <li key={sig.label} className="flex gap-2 text-sm">
                  <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", sig.kind === "risk" ? "bg-rose-500" : sig.kind === "opportunity" ? "bg-indigo-500" : sig.kind === "contact" ? "bg-emerald-500" : "bg-sky-500")} />
                  <span>
                    {sig.label}
                    {sig.evidence && <span className="block text-xs italic text-slate-500 dark:text-slate-400">“…{sig.evidence}…”</span>}
                  </span>
                </li>
              ))}
            </ul>
            {lead.ai && (lead.ai.fitReasons.length > 0 || lead.ai.risks.length > 0) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <MiniList title="AI: why it fits" items={lead.ai.fitReasons} />
                <MiniList title="AI: open questions" items={lead.ai.risks} />
              </div>
            )}
          </Section>

          <Section title="Contacts">
            {lead.people.length > 0 && (
              <ul className="mb-3 space-y-1">
                {lead.people.map((p) => (
                  <li key={p.name} className="text-sm">
                    <span className="font-medium">{p.name}</span> <span className="text-slate-500">· {p.title}</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="space-y-1.5">
              {lead.emails.map((e) => (
                <li key={e.address} className="flex flex-wrap items-center gap-2 text-sm">
                  <CopyText text={e.address} />
                  <EmailBadge email={e} />
                  <span className="text-xs text-slate-400">{e.source}</span>
                </li>
              ))}
              {lead.phones.map((ph) => (
                <li key={ph} className="text-sm">
                  <CopyText text={ph} />
                </li>
              ))}
              {lead.emails.length === 0 && lead.phones.length === 0 && <li className="text-sm text-slate-500">No contact details published on the site.</li>}
            </ul>
            {Object.keys(lead.socials).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(lead.socials).map(([k, v]) => (
                  <a key={k} href={v} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 px-2 py-1 text-xs capitalize hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                    {k} ↗
                  </a>
                ))}
              </div>
            )}
          </Section>

          <Section title="Company facts">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Fact k="Founded" v={lead.foundedYear ? `${lead.foundedYear} (${lead.yearsInBusiness} yrs)` : "Unknown"} />
              <Fact k="Location" v={lead.location ?? "Unknown"} />
              <Fact k="Industry" v={lead.ai?.industry ?? "—"} />
              <Fact k="Est. size" v={lead.ai?.estimatedSize ?? "—"} />
              <Fact k="Model" v={lead.ai?.businessModel ?? "—"} />
              <Fact k="Hiring" v={lead.hiring ? "Yes, careers page" : "No signal"} />
            </dl>
            {lead.tech.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {lead.tech.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </div>
            )}
          </Section>

          <Section title="Sources">
            <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
              {lead.pagesScanned.map((u) => (
                <li key={u} className="truncate">
                  <a href={u} target="_blank" rel="noreferrer" className="hover:underline">
                    {u}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-400">
              {lead.fromCache ? "Served from cache" : `Fetched live in ${(lead.durationMs / 1000).toFixed(1)}s`} · public pages only, robots.txt respected
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Opener({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/10">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Suggested opener</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(text).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="font-mono text-[13px] hover:text-indigo-600 dark:hover:text-indigo-400"
    >
      {copied ? "Copied ✓" : text}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="grid grid-cols-[130px_1fr_44px] items-center gap-3 text-sm">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="text-right tabular-nums text-slate-500">
        {value}/{max}
      </span>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <div className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</div>
      <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-300">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
