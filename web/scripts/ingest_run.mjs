#!/usr/bin/env node
/*
 * Ingest a completed pipeline run into seq2func.win from local pipeline outputs.
 *
 * Usage:
 *   node scripts/ingest_run.mjs <run_id> [--url=https://seq2func.win]
 *
 * Reads: nf-transcriptome/results/<run_id>/{annotations,sra,trinity}/... + pipeline_trace.txt + .nextflow.log
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: node scripts/ingest_run.mjs <run_id> [--url=https://seq2func.win]");
  process.exit(1);
}

const urlArg = process.argv.find((a) => a.startsWith("--url="));
const apiBase = urlArg ? urlArg.slice("--url=".length) : "https://seq2func.win";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pipeRoot = path.join(repoRoot, "nf-transcriptome");
const runDir = path.join(pipeRoot, "results", runId);

if (!fs.existsSync(runDir)) {
  console.error(`Run dir not found: ${runDir}`);
  process.exit(1);
}

// ── Annotations ────────────────────────────────────────────────────────────
const annotationsPath = path.join(runDir, "annotations", "annotations.json");
const annotations = JSON.parse(fs.readFileSync(annotationsPath, "utf-8"));
console.log(`Loaded ${annotations.length} proteins from ${annotationsPath}`);

// ── SRA metadata ───────────────────────────────────────────────────────────
let sraMetadata = undefined;
const sraPath = path.join(runDir, "sra", "sra_metadata.json");
if (fs.existsSync(sraPath)) {
  sraMetadata = JSON.parse(fs.readFileSync(sraPath, "utf-8"));
  console.log(`Loaded SRA metadata: ${sraMetadata.organism}, ${sraMetadata.total_reads} reads`);
}

// ── Assembly stats from Trinity FASTA ──────────────────────────────────────
let assemblyStats = undefined;
const trinityFasta = path.join(runDir, "trinity", "trinity_out.Trinity.fasta");
if (fs.existsSync(trinityFasta)) {
  const contigLengths = [];
  let currentLen = 0;
  const text = fs.readFileSync(trinityFasta, "utf-8");
  for (const line of text.split("\n")) {
    if (line.startsWith(">")) {
      if (currentLen > 0) contigLengths.push(currentLen);
      currentLen = 0;
    } else {
      currentLen += line.trim().length;
    }
  }
  if (currentLen > 0) contigLengths.push(currentLen);

  contigLengths.sort((a, b) => b - a);
  const total = contigLengths.reduce((a, b) => a + b, 0);
  let running = 0;
  let n50 = 0;
  for (const len of contigLengths) {
    running += len;
    if (running >= total / 2) {
      n50 = len;
      break;
    }
  }
  assemblyStats = { num_contigs: contigLengths.length, n50 };
  console.log(`Assembly: ${assemblyStats.num_contigs} contigs, N50=${n50}`);
}

// ── Step timings from pipeline_trace.txt ───────────────────────────────────
const stepTimings = [];
const tracePath = path.join(pipeRoot, "results", "pipeline_trace.txt");
if (fs.existsSync(tracePath)) {
  const lines = fs.readFileSync(tracePath, "utf-8").split("\n");
  const header = lines[0].split("\t");
  const idx = (n) => header.indexOf(n);
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const process = cols[idx("process")];
    const tag = cols[idx("tag")] || "";
    const submit = cols[idx("submit")];
    const complete = cols[idx("complete")];
    const duration = cols[idx("duration")];
    const peakRss = cols[idx("peak_rss")];

    // Only include rows matching this run (tag == DRR028935 for full_test_007).
    // Trace is global, so filter by srr_id if known.
    const expectedTag = sraMetadata?.srr_id;
    if (expectedTag && tag !== expectedTag) continue;

    if (process && submit && complete) {
      stepTimings.push({
        step_name: process,
        started_at: new Date(submit.replace(" ", "T") + "Z").toISOString(),
        completed_at: new Date(complete.replace(" ", "T") + "Z").toISOString(),
        metrics: { duration, peak_rss: peakRss },
      });
    }
  }
  console.log(`Loaded ${stepTimings.length} step timings`);
}

// Step-specific metrics
const srrMetaForSteps = sraMetadata
  ? {
      total_reads: sraMetadata.total_reads,
      total_bases: sraMetadata.total_bases,
      organism: sraMetadata.organism,
      library_layout: sraMetadata.library_layout,
      platform: sraMetadata.platform,
      study_title: sraMetadata.study_title,
    }
  : null;

for (const st of stepTimings) {
  if (st.step_name === "SRA_DOWNLOAD" && srrMetaForSteps) {
    Object.assign(st.metrics, srrMetaForSteps);
  }
  if (st.step_name === "TRINITY" && assemblyStats) {
    Object.assign(st.metrics, assemblyStats);
  }
  if (st.step_name === "TRANSDECODER_PREDICT") {
    st.metrics.predicted_proteins = annotations.length;
  }
  if (st.step_name === "CDD_SEARCH") {
    const totalDomains = annotations.reduce((n, a) => n + (a.cdd?.domains?.length || 0), 0);
    st.metrics.total_domains = totalDomains;
    st.metrics.proteins_with_domains = annotations.filter((a) => a.cdd?.domains?.length).length;
  }
  if (st.step_name === "PROSTT5_PREDICT") {
    st.metrics.predictions = annotations.filter((a) => a.prostt5?.has_prediction).length;
  }
  if (st.step_name === "FOLDSEEK_SEARCH") {
    const totalHits = annotations.reduce((n, a) => n + (a.foldseek?.hits?.length || 0), 0);
    st.metrics.total_hits = totalHits;
    st.metrics.proteins_with_hits = annotations.filter((a) => a.foldseek?.hits?.length).length;
  }
}

// ── Logs from .nextflow.log ────────────────────────────────────────────────
const logs = [];
const nfLog = path.join(pipeRoot, ".nextflow.log");
if (fs.existsSync(nfLog)) {
  const text = fs.readFileSync(nfLog, "utf-8");
  const logLineRe = /^(\w{3}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+\[([^\]]+)\]\s+(\w+)\s+([^\s-]+)\s*-?\s*(.*)$/;
  const year = new Date().getUTCFullYear();
  for (const line of text.split("\n")) {
    const m = line.match(logLineRe);
    if (!m) continue;
    const [, stamp, , lvl, source, msg] = m;
    if (!msg) continue;
    const level = lvl.toLowerCase() === "warn" ? "warn" : lvl.toLowerCase() === "error" ? "error" : lvl.toLowerCase() === "debug" ? "debug" : "info";
    const d = new Date(`${stamp.replace("-", " ")} ${year}`);
    logs.push({
      timestamp: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
      level,
      source: source.includes("nextflow") ? "nextflow" : `step:${source.split(".").pop()}`,
      message: msg.slice(0, 500),
    });
  }
  console.log(`Parsed ${logs.length} log lines`);
}

// Fallback: synthesize minimal log narrative from step timings if we got nothing
if (logs.length === 0 && stepTimings.length > 0) {
  for (const st of stepTimings) {
    if (st.started_at) {
      logs.push({
        timestamp: st.started_at,
        level: "info",
        source: `step:${st.step_name}`,
        message: `${st.step_name} started`,
      });
    }
    if (st.completed_at) {
      logs.push({
        timestamp: st.completed_at,
        level: "info",
        source: `step:${st.step_name}`,
        message: `${st.step_name} completed in ${st.metrics?.duration ?? "?"}`,
      });
    }
  }
  console.log(`Synthesized ${logs.length} narrative log entries`);
}

// ── POST to ingest endpoint ────────────────────────────────────────────────
const payload = {
  annotations,
  srrId: sraMetadata?.srr_id,
  sampleName: sraMetadata?.study_title,
  sraMetadata,
  assemblyStats,
  stepTimings,
  logs,
};

const url = `${apiBase}/api/pipeline/ingest/${runId}`;
console.log(`\nPOST ${url}`);
console.log(`Payload size: ${(JSON.stringify(payload).length / 1024).toFixed(1)} KB`);

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text);
if (!res.ok) process.exit(1);
