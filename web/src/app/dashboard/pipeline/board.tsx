"use client";

import { useOptimistic, useState, useTransition } from "react";
import { updateLeadStage } from "../leads/actions";

export type BoardLead = {
  id: string;
  name: string | null;
  phone: string;
  carInterest: string | null;
  stage: string;
  lastContact: string;
};

type Stage = { id: string; label: string };

const stageAccent: Record<string, string> = {
  new: "border-t-sky-500",
  contacted: "border-t-teal-500",
  test_drive_booked: "border-t-violet-500",
  negotiating: "border-t-amber-500",
  sold: "border-t-emerald-500",
  lost: "border-t-slate-400",
};

// Kanban board: drag a card to another column (or use its menu on touch screens) to change the lead's stage.
export function PipelineBoard({ leads, stages }: { leads: BoardLead[]; stages: readonly Stage[] }) {
  const [optimisticLeads, moveLead] = useOptimistic(leads, (current, move: { id: string; stage: string }) =>
    current.map((l) => (l.id === move.id ? { ...l, stage: move.stage } : l)),
  );
  const [, startTransition] = useTransition();
  const [overStage, setOverStage] = useState<string | null>(null);

  function changeStage(id: string, stage: string) {
    const lead = optimisticLeads.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    startTransition(async () => {
      moveLead({ id, stage });
      await updateLeadStage(id, stage);
    });
  }

  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
      {stages.map((stage) => {
        const cards = optimisticLeads.filter((l) => l.stage === stage.id);
        return (
          <section
            key={stage.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOverStage(stage.id);
            }}
            onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setOverStage(null);
              changeStage(e.dataTransfer.getData("text/plain"), stage.id);
            }}
            aria-label={stage.label}
            className={`flex min-w-52 flex-1 snap-start flex-col rounded-2xl border-t-4 bg-slate-100 p-2 ring-1 ring-slate-200 ${stageAccent[stage.id] ?? ""} ${
              overStage === stage.id ? "ring-2 ring-indigo-400" : ""
            }`}
          >
            <header className="flex items-center justify-between px-2 py-2">
              <h2 className="text-sm font-semibold text-slate-800">{stage.label}</h2>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700 ring-1 ring-slate-200">{cards.length}</span>
            </header>
            <ul className="flex min-h-24 flex-col gap-2">
              {cards.map((lead) => (
                <li
                  key={lead.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", lead.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="cursor-grab rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 transition hover:ring-indigo-300 active:cursor-grabbing"
                >
                  <p className="truncate font-medium text-slate-900">{lead.name ?? "Unknown caller"}</p>
                  <p className="text-xs text-slate-500">{lead.phone}</p>
                  {lead.carInterest && <p className="mt-1 text-xs text-slate-700">🚗 {lead.carInterest}</p>}
                  <p className="mt-1 text-[11px] text-slate-500">{lead.lastContact}</p>
                  <div className="mt-2">
                    <select
                      aria-label="Move to stage"
                      value={lead.stage}
                      onChange={(e) => changeStage(lead.id, e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
              {cards.length === 0 && (
                <li className="rounded-xl border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">Drop a lead here</li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
