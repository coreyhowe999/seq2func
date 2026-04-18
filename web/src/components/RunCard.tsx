"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import type { PipelineRun } from "@/lib/types";

interface RunCardProps {
  run: PipelineRun;
}

export default function RunCard({ run }: RunCardProps) {
  const completedSteps = run.stepCounts?.completed || 0;
  const totalSteps = run.stepCounts?.total || 11;
  const progressPercent = (completedSteps / totalSteps) * 100;

  const createdDate = new Date(run.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link href={`/runs/${run.id}`}>
      <div className="card hover:border-teal-500/50 hover:bg-navy-800/80 transition-all duration-200 cursor-pointer group">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="font-mono font-semibold text-gray-100 group-hover:text-teal-300 transition-colors">
              {run.srrId}
            </p>
            {run.sampleName && run.sampleName !== run.srrId && (
              <p className="text-sm text-gray-400 mt-0.5">{run.sampleName}</p>
            )}
          </div>
          <StatusBadge status={run.status} size="sm" />
        </div>

        {/* Metadata */}
        {run.organism && (
          <p className="text-xs text-gray-500 italic mb-2">{run.organism}</p>
        )}

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{completedSteps}/{totalSteps} steps</span>
            <span>{createdDate}</span>
          </div>
          <div className="w-full bg-navy-900 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${
                run.status === "failed"
                  ? "bg-red-500"
                  : run.status === "completed"
                  ? "bg-green-500"
                  : "bg-teal-500"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        {run.totalProteins && (
          <p className="text-xs text-gray-500 mt-2">
            {run.totalProteins} proteins annotated
          </p>
        )}
      </div>
    </Link>
  );
}
