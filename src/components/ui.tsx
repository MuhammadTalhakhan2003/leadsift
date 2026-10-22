import type { ReactNode } from "react";
import type { EmailResult, Tier } from "@/lib/types";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const TIER_STYLE: Record<Tier, string> = {
  hot: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  warm: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  cold: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset", TIER_STYLE[tier])}>
      {tier}
    </span>
  );
}

export function ScoreRing({ score, tier, size = 44 }: { score: number; tier: Tier; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = tier === "hot" ? "stroke-rose-500" : tier === "warm" ? "stroke-amber-500" : "stroke-slate-400";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`Score ${score} of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={5} className="fill-none stroke-slate-200 dark:stroke-slate-700" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          className={cx("fill-none transition-[stroke-dashoffset] duration-700", color)}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold tabular-nums">{score}</span>
    </div>
  );
}

export function EmailBadge({ email }: { email: EmailResult }) {
  const label = email.guessed
    ? "Guess"
    : email.confidence === "high"
      ? "Direct"
      : email.roleBased
        ? "Shared inbox"
        : email.status === "verified-domain"
          ? "Verified domain"
          : "Unverified";
  const style = email.guessed
    ? "text-slate-500 ring-slate-300 dark:ring-slate-600"
    : email.confidence === "high"
      ? "text-emerald-700 ring-emerald-300 dark:text-emerald-300 dark:ring-emerald-500/40"
      : email.confidence === "medium"
        ? "text-sky-700 ring-sky-300 dark:text-sky-300 dark:ring-sky-500/40"
        : "text-slate-500 ring-slate-300 dark:ring-slate-600";
  return <span className={cx("rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset", style)}>{label}</span>;
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "accent" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    bad: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    accent: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  };
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs", tones[tone])}>{children}</span>;
}

export function StepLabel({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-600 text-[11px] text-white">{n}</span>
      {children}
    </div>
  );
}
