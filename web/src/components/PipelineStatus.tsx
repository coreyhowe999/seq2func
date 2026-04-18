"use client";

import type { PipelineStep } from "@/lib/types";

interface PipelineStatusProps {
  steps: PipelineStep[];
}

// Define step display order and grouping
const STEP_ORDER = [
  { name: "SRA_DOWNLOAD", label: "SRA Download", group: "sequential" },
  { name: "FASTQC", label: "FastQC", group: "sequential" },
  { name: "TRIMMOMATIC", label: "Trimmomatic", group: "sequential" },
  { name: "FASTQC_TRIMMED", label: "FastQC (Trimmed)", group: "sequential" },
  { name: "TRINITY", label: "Trinity", group: "sequential" },
  { name: "TRANSDECODER_LONGORFS", label: "TD LongOrfs", group: "sequential" },
  { name: "TRANSDECODER_PREDICT", label: "TD Predict", group: "sequential" },
  { name: "CDD_SEARCH", label: "CDD Search", group: "parallel" },
  { name: "PROSTT5_PREDICT", label: "ProstT5", group: "parallel" },
  { name: "FOLDSEEK_SEARCH", label: "FoldSeek", group: "parallel" },
  { name: "MERGE_RESULTS", label: "Merge Results", group: "final" },
];

function getStepStatus(steps: PipelineStep[], stepName: string): PipelineStep | undefined {
  return steps.find((s) => s.stepName === stepName);
}

function getDuration(step: PipelineStep): string {
  if (!step.startedAt || !step.completedAt) return "";
  const start = new Date(step.startedAt).getTime();
  const end = new Date(step.completedAt).getTime();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function getMetricsSummary(step: PipelineStep): string {
  if (!step.metrics) return "";
  try {
    const m = JSON.parse(step.metrics);
    switch (step.stepName) {
      case "SRA_DOWNLOAD":
        return m.total_reads ? `${(m.total_reads / 1e6).toFixed(1)}M reads` : "";
      case "TRIMMOMATIC":
        return m.percent_surviving ? `${m.percent_surviving}% survived` : "";
      case "TRINITY":
        return m.num_contigs ? `${m.num_contigs.toLocaleString()} contigs` : "";
      case "TRANSDECODER_PREDICT":
        return m.predicted_proteins ? `${m.predicted_proteins} proteins` : "";
      case "CDD_SEARCH":
        return m.total_domains ? `${m.total_domains} domains` : "";
      case "PROSTT5_PREDICT":
        return m.predictions ? `${m.predictions} predicted` : "";
      case "FOLDSEEK_SEARCH":
        return m.total_hits ? `${m.total_hits} hits` : "";
      default:
        return "";
    }
  } catch {
    return "";
  }
}

const statusColors: Record<string, { bg: string; border: string; ring: string }> = {
  pending: { bg: "bg-navy-700", border: "border-navy-600", ring: "" },
  running: { bg: "bg-blue-900/40", border: "border-blue-500", ring: "ring-2 ring-blue-500/30 animate-pulse-slow" },
  completed: { bg: "bg-green-900/30", border: "border-green-600", ring: "" },
  failed: { bg: "bg-red-900/30", border: "border-red-600", ring: "" },
  skipped: { bg: "bg-navy-700/50", border: "border-navy-600", ring: "" },
};

function StepNode({ stepDef, step }: { stepDef: typeof STEP_ORDER[0]; step?: PipelineStep }) {
  const status = step?.status || "pending";
  const colors = statusColors[status] || statusColors.pending;
  const duration = step ? getDuration(step) : "";
  const metrics = step ? getMetricsSummary(step) : "";

  const statusIcons: Record<string, string> = {
    pending: "\u23F3",
    running: "\uD83D\uDD04",
    completed: "\u2705",
    failed: "\u274C",
    skipped: "\u23ED\uFE0F",
  };

  return (
    <div
      className={`rounded-lg border p-3 min-w-[130px] ${colors.bg} ${colors.border} ${colors.ring} transition-all duration-300`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-sm ${status === "running" ? "animate-spin inline-block" : ""}`}>
          {statusIcons[status]}
        </span>
        <span className="text-xs font-medium text-gray-200 truncate">
          {stepDef.label}
        </span>
      </div>
      {duration && (
        <p className="text-xs text-gray-500">{duration}</p>
      )}
      {metrics && (
        <p className="text-xs text-teal-400 mt-0.5">{metrics}</p>
      )}
    </div>
  );
}

export default function PipelineStatus({ steps }: PipelineStatusProps) {
  const sequentialSteps = STEP_ORDER.filter((s) => s.group === "sequential");
  const parallelSteps = STEP_ORDER.filter((s) => s.group === "parallel");
  const finalSteps = STEP_ORDER.filter((s) => s.group === "final");

  return (
    <div className="space-y-4">
      {/* Sequential steps (horizontal on desktop, vertical on mobile) */}
      <div className="flex flex-wrap gap-2 items-center">
        {sequentialSteps.map((stepDef, i) => (
          <div key={stepDef.name} className="flex items-center gap-2">
            <StepNode stepDef={stepDef} step={getStepStatus(steps, stepDef.name)} />
            {i < sequentialSteps.length - 1 && (
              <svg className="w-4 h-4 text-navy-600 flex-shrink-0 hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        ))}
      </div>

      {/* Parallel annotation branches */}
      <div className="flex items-center gap-4 ml-4">
        <div className="w-px h-16 bg-navy-600" />
        <div className="flex flex-col sm:flex-row gap-2">
          {parallelSteps.map((stepDef) => (
            <StepNode key={stepDef.name} stepDef={stepDef} step={getStepStatus(steps, stepDef.name)} />
          ))}
        </div>
        <div className="w-px h-16 bg-navy-600" />
      </div>

      {/* Final merge step */}
      <div className="flex items-center gap-2 ml-4">
        <svg className="w-4 h-4 text-navy-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
        {finalSteps.map((stepDef) => (
          <StepNode key={stepDef.name} stepDef={stepDef} step={getStepStatus(steps, stepDef.name)} />
        ))}
      </div>
    </div>
  );
}
