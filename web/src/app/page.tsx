"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import RunCard from "@/components/RunCard";
import type { PipelineRun } from "@/lib/types";

const SRR_REGEX = /^[SDE]RR\d{6,}$/;

export default function HomePage() {
  const router = useRouter();
  const [srrId, setSrrId] = useState("");
  const [sampleName, setSampleName] = useState("");
  const [profile, setProfile] = useState("standard");
  const [foldseekDb, setFoldseekDb] = useState("pdb");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);

  // Fetch recent runs
  useEffect(() => {
    fetch("/api/runs")
      .then((res) => res.json())
      .then((data) => {
        setRuns(Array.isArray(data) ? data : []);
        setLoadingRuns(false);
      })
      .catch(() => setLoadingRuns(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmed = srrId.trim().toUpperCase();

    if (!SRR_REGEX.test(trimmed)) {
      setError("Invalid SRA accession. Must be SRR/ERR/DRR followed by 6+ digits (e.g., SRR5437876)");
      return;
    }

    setIsSubmitting(true);

    try {
      const runId = `run_${Date.now()}_${uuidv4().slice(0, 8)}`;

      const res = await fetch("/api/pipeline/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          srrId: trimmed,
          sampleName: sampleName.trim() || trimmed,
          runId,
          profile,
          foldseekDb: profile === "gcp" ? foldseekDb : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to launch pipeline");
        setIsSubmitting(false);
        return;
      }

      router.push(`/runs/${data.runId}`);
    } catch {
      setError("Network error. Please check your connection.");
      setIsSubmitting(false);
    }
  };

  const isValid = SRR_REGEX.test(srrId.trim().toUpperCase());

  return (
    <div className="space-y-12">
      {/* ── Section 1: Submission Form ── */}
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-100 mb-3">
            De Novo Transcriptome Assembly & Annotation
          </h1>
          <p className="text-gray-400 text-lg">
            Enter an SRA accession ID to launch a new pipeline run
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label htmlFor="srrId" className="block text-sm font-medium text-gray-300 mb-2">
              SRA Accession ID
            </label>
            <input
              id="srrId"
              type="text"
              value={srrId}
              onChange={(e) => {
                setSrrId(e.target.value);
                setError("");
              }}
              placeholder="SRR5437876"
              className="input-field text-lg font-mono"
              autoFocus
            />
            {srrId && !isValid && (
              <p className="mt-2 text-sm text-red-400">
                Must match format: SRR/ERR/DRR followed by 6+ digits
              </p>
            )}
          </div>

          <div>
            <label htmlFor="sampleName" className="block text-sm font-medium text-gray-300 mb-2">
              Sample Name <span className="text-gray-500">(optional)</span>
            </label>
            <input
              id="sampleName"
              type="text"
              value={sampleName}
              onChange={(e) => setSampleName(e.target.value)}
              placeholder="e.g., Arabidopsis Drought Stress"
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor="profile" className="block text-sm font-medium text-gray-300 mb-2">
              Execution Environment
            </label>
            <select
              id="profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              className="input-field"
            >
              <option value="standard">Local Docker</option>
              <option value="gcp">GCP Cloud (auto-provisions VMs)</option>
              <option value="test">Test Mode (skip CDD/ProstT5/FoldSeek)</option>
            </select>
            {profile === "gcp" && (
              <p className="mt-1 text-xs text-teal-400">
                Spins up GCP VMs on demand. GPU (NVIDIA L4) for ProstT5. Spot pricing ~$0.50-2.00/run.
              </p>
            )}
          </div>

          {profile === "gcp" && (
            <div>
              <label htmlFor="foldseekDb" className="block text-sm font-medium text-gray-300 mb-2">
                FoldSeek Structure Database
              </label>
              <select
                id="foldseekDb"
                value={foldseekDb}
                onChange={(e) => setFoldseekDb(e.target.value)}
                className="input-field"
              >
                <option value="pdb">PDB — 200K experimental structures (~2 min/1K proteins)</option>
                <option value="swissprot">AlphaFold/Swiss-Prot — 500K curated (~4 min/1K proteins)</option>
                <option value="proteome">AlphaFold/Proteome — 48M structures (~2 hrs/1K proteins)</option>
                <option value="uniprot50">AlphaFold/UniProt50 — 54M clustered (~2.5 hrs/1K proteins)</option>
              </select>
            </div>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-3">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!isValid || isSubmitting}
            className="btn-primary w-full text-lg py-3 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Launching Pipeline...
              </>
            ) : (
              "Launch Pipeline"
            )}
          </button>
        </form>
      </div>

      {/* ── Section 2: Recent Runs ── */}
      <div>
        <h2 className="text-xl font-semibold text-gray-200 mb-4">Recent Runs</h2>

        {loadingRuns ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
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
              No runs yet. Enter an SRR accession above to get started.
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
    </div>
  );
}
