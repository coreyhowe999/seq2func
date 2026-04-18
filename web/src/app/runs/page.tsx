"use client";

import { useState, useEffect } from "react";
import RunCard from "@/components/RunCard";
import type { PipelineRun } from "@/lib/types";

export default function RunsPage() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/runs")
      .then((res) => res.json())
      .then((data) => {
        setRuns(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-100 mb-6">All Pipeline Runs</h1>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-4 bg-navy-700 rounded w-3/4 mb-3" />
              <div className="h-3 bg-navy-700 rounded w-1/2 mb-2" />
              <div className="h-3 bg-navy-700 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 text-lg">
            No pipeline runs yet. Go to the home page to start one.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
