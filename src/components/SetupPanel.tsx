"use client";

import { useRef, useState } from "react";
import { PRESETS } from "@/lib/presets";
import type { Icp, PresetId } from "@/lib/types";
import { cx, StepLabel } from "./ui";

interface Props {
  icp: Icp;
  onIcpChange: (icp: Icp) => void;
  input: string;
  onInputChange: (v: string) => void;
  onCsv: (file: File) => void;
  onSample: () => void;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  queued: number;
  csvLabel: string | null;
}

export function SetupPanel(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const setPreset = (id: PresetId) =>
    p.onIcpChange({ ...p.icp, preset: id, minYears: PRESETS[id].defaults.minYears });

  return (
    <aside className="flex flex-col gap-6 border-b border-slate-200 bg-white p-5 lg:sticky lg:top-0 lg:h-[calc(100vh-57px)] lg:overflow-y-auto lg:border-b-0 lg:border-r dark:border-slate-800 dark:bg-slate-900">
      <section>
        <StepLabel n={1}>Who is a good lead?</StepLabel>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(PRESETS).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setPreset(preset.id)}
              className={cx(
                "rounded-lg border p-3 text-left transition",
                p.icp.preset === preset.id
                  ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:bg-indigo-500/10"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600",
              )}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">{preset.label}</div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{preset.persona}</div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{PRESETS[p.icp.preset].blurb}</p>

        <div className="mt-4 space-y-3">
          <TagField
            label="Industries or keywords"
            placeholder="e.g. hvac, plumbing, landscaping"
            values={p.icp.industries}
            onChange={(industries) => p.onIcpChange({ ...p.icp, industries })}
          />
          <TagField
            label="Locations"
            placeholder="e.g. texas, ohio (blank = anywhere)"
            values={p.icp.locations}
            onChange={(locations) => p.onIcpChange({ ...p.icp, locations })}
          />
          <label className="block">
            <span className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
              Minimum years in business <span className="tabular-nums text-slate-900 dark:text-white">{p.icp.minYears}+</span>
            </span>
            <input
              type="range"
              min={0}
              max={40}
              step={5}
              value={p.icp.minYears}
              onChange={(e) => p.onIcpChange({ ...p.icp, minYears: Number(e.target.value) })}
              className="mt-2 w-full accent-indigo-600"
            />
          </label>
        </div>
      </section>

      <section>
        <StepLabel n={2}>Which companies?</StepLabel>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) p.onCsv(f);
          }}
          className={cx("rounded-lg transition", dragging && "ring-2 ring-indigo-500")}
        >
          <textarea
            value={p.input}
            onChange={(e) => p.onInputChange(e.target.value)}
            rows={7}
            placeholder={"One website per line, or drop a CSV here\n\nacmehvac.com\nhttps://www.example-plumbing.com"}
            className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed outline-none focus:border-indigo-500 focus:bg-white dark:border-slate-700 dark:bg-slate-950 dark:focus:bg-slate-950"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-md border border-slate-200 px-2.5 py-1.5 font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            Upload CSV
          </button>
          <button type="button" onClick={p.onSample} className="rounded-md px-2.5 py-1.5 font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">
            Load sample list
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onCsv(f);
              e.target.value = "";
            }}
          />
          {p.csvLabel && <span className="text-slate-500">{p.csvLabel}</span>}
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Works with SaaSquatch, Apollo or CRM exports. We find the website column and skip duplicates automatically.
        </p>
      </section>

      <div className="mt-auto">
        {p.running ? (
          <button type="button" onClick={p.onStop} className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900">
            Stop ({p.queued} left)
          </button>
        ) : (
          <button
            type="button"
            onClick={p.onRun}
            disabled={!p.input.trim()}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Qualify leads
          </button>
        )}
      </div>
    </aside>
  );
}

function TagField(props: { label: string; placeholder: string; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const parts = draft.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length) props.onChange([...new Set([...props.values, ...parts])]);
    setDraft("");
  };
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{props.label}</span>
      <div className="mt-1 flex flex-wrap gap-1.5 rounded-lg border border-slate-200 p-1.5 focus-within:border-indigo-500 dark:border-slate-700">
        {props.values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => props.onChange(props.values.filter((x) => x !== v))} className="opacity-60 hover:opacity-100">
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && props.values.length) {
              props.onChange(props.values.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={props.values.length ? "" : props.placeholder}
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-slate-400"
        />
      </div>
    </label>
  );
}
