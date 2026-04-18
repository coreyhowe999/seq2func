"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import PipelineStatus from "@/components/PipelineStatus";
import ProteinTable from "@/components/ProteinTable";
import StatusBadge from "@/components/StatusBadge";
import LogViewer from "@/components/LogViewer";
import type { PipelineRun, PipelineStep, ProteinAnnotation } from "@/lib/types";

interface RunData {
  run: PipelineRun & { steps: PipelineStep[] };
  proteins: ProteinAnnotation[];
  total: number;
  page: number;
  pageSize: number;
}

export default function RunDetailPage() {
  const params = useParams();
  const runId = params.runId as string;

  const [runData, setRunData] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/results/${runId}?page=${page}&pageSize=50&search=${encodeURIComponent(search)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRunData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run data");
    } finally {
      setLoading(false);
    }
  }, [runId, page, search]);

  // Initial fetch and polling
  useEffect(() => {
    fetchData();

    const isActive = runData?.run?.status === "running" || runData?.run?.status === "pending";
    if (isActive || loading) {
      const interval = setInterval(fetchData, 3000);
      return () => clearInterval(interval);
    }
  }, [fetchData, runData?.run?.status, loading]);

  if (loading && !runData) {
    return (
      <div className="space-y-6">
        <div className="card animate-pulse">
          <div className="h-8 bg-navy-700 rounded w-1/3 mb-4" />
          <div className="h-4 bg-navy-700 rounded w-1/2 mb-2" />
          <div className="h-4 bg-navy-700 rounded w-2/3" />
        </div>
        <div className="card animate-pulse h-32" />
        <div className="card animate-pulse h-64" />
      </div>
    );
  }

  if (error && !runData) {
    return (
      <div className="card text-center py-12">
        <p className="text-red-400 text-lg mb-4">Error loading run: {error}</p>
        <button onClick={fetchData} className="btn-primary">
          Retry
        </button>
      </div>
    );
  }

  if (!runData) return null;

  const { run, proteins, total } = runData;
  const isRunning = run.status === "running" || run.status === "pending";
  const isCompleted = run.status === "completed";

  return (
    <div className="space-y-6">
      {/* ── Section 0: Run Header ── */}
      <div className="card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-100 font-mono">
                {run.srrId}
              </h1>
              <StatusBadge status={run.status} />
            </div>
            {run.sampleName && run.sampleName !== run.srrId && (
              <p className="text-gray-400">{run.sampleName}</p>
            )}
          </div>
          <a
            href={`https://www.ncbi.nlm.nih.gov/sra/${run.srrId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal-400 hover:text-teal-300 text-sm font-medium transition-colors"
          >
            View on NCBI SRA &rarr;
          </a>
        </div>

        {/* SRA Metadata */}
        {(run.organism || run.libraryLayout) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-4 pt-4 border-t border-navy-700">
            {run.organism && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Organism</p>
                <p className="text-sm text-gray-200 italic">{run.organism}</p>
              </div>
            )}
            {run.libraryLayout && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Layout</p>
                <p className="text-sm text-gray-200">{run.libraryLayout}</p>
              </div>
            )}
            {run.platform && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Platform</p>
                <p className="text-sm text-gray-200">{run.platform}</p>
              </div>
            )}
            {run.totalReads && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Total Reads</p>
                <p className="text-sm text-gray-200">{run.totalReads.toLocaleString()}</p>
              </div>
            )}
            {run.totalContigs && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Contigs</p>
                <p className="text-sm text-gray-200">{run.totalContigs.toLocaleString()}</p>
              </div>
            )}
            {run.n50 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">N50</p>
                <p className="text-sm text-gray-200">{run.n50.toLocaleString()} bp</p>
              </div>
            )}
          </div>
        )}

        {run.studyTitle && (
          <p className="text-sm text-gray-400 mt-3 italic">{run.studyTitle}</p>
        )}

        {run.errorMessage && (
          <div className="mt-4 bg-red-900/30 border border-red-700 rounded-lg p-3">
            <p className="text-sm text-red-300">{run.errorMessage}</p>
          </div>
        )}
      </div>

      {/* ── Section 1: Pipeline Status Tracker ── */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Pipeline Progress</h2>
        <PipelineStatus steps={run.steps || []} />
      </div>

      {/* ── Section 1.5: Pipeline Logs ── */}
      <LogViewer runId={runId} isActive={isRunning} />

      {/* ── Section 2: Protein Results Table ── */}
      {isCompleted && proteins.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-200">
              Protein Annotations ({total})
            </h2>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search proteins, domains, hits..."
              className="input-field w-64"
            />
          </div>
          <ProteinTable
            proteins={proteins}
            total={total}
            page={page}
            pageSize={50}
            onPageChange={setPage}
          />
        </div>
      )}

      {isCompleted && proteins.length === 0 && (
        <div className="card text-center py-8">
          <p className="text-gray-400">No protein annotations found for this run.</p>
        </div>
      )}

      {isRunning && (
        <div className="card text-center py-8">
          <div className="flex items-center justify-center gap-3">
            <svg className="animate-spin h-5 w-5 text-teal-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-gray-400">Pipeline is running. Results will appear here when complete.</p>
          </div>
        </div>
      )}
    </div>
  );
}
