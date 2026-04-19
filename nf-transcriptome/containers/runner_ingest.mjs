#!/usr/bin/env node
/*
 * Cloud Run Job ingest — posts completed pipeline outputs to the web UI.
 * Parameterized for container-based use (paths supplied via flags).
 *
 * Usage:
 *   node runner_ingest.mjs <run_id> --results=DIR --pipeline=DIR --log=FILE --url=https://seq2func.win
 */
import fs from "node:fs";
import path from "node:path";

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: runner_ingest.mjs <run_id> --results=DIR --pipeline=DIR --log=FILE --url=URL");
  process.exit(1);
}

function flag(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}

const resultsDir = flag("results") || "/tmp/nf_results";
const pipeRoot = flag("pipeline") || "/app/nf-transcriptome";
const logFile = flag("log");
const apiBase = flag("url") || "https://seq2func.win";

const runDir = path.join(resultsDir, runId);
console.log(`Scanning ${runDir}`);

// Annotations — may not exist if pipeline failed mid-way.
const annotationsPath = path.join(runDir, "annotations", "annotations.json");
let annotations = [];
if (fs.existsSync(annotationsPath)) {
  annotations = JSON.parse(fs.readFileSync(annotationsPath, "utf-8"));
  console.log(`Loaded ${annotations.length} proteins`);
} else {
  console.log("No annotations.json (pipeline may have failed before MERGE_RESULTS)");
}

// SRA metadata
let sraMetadata;
const sraPath = path.join(runDir, "sra", "sra_metadata.json");
if (fs.existsSync(sraPath)) {
  sraMetadata = JSON.parse(fs.readFileSync(sraPath, "utf-8"));
}

// Assembly stats from Trinity FASTA
let assemblyStats;
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
}

// Step timings — from the pipeline's global trace file (Nextflow writes this)
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
  console.log(`Loaded ${stepTimings.length} step timings from trace`);
}

// Enrich step metrics with totals from other artifacts
for (const st of stepTimings) {
  if (st.step_name === "SRA_DOWNLOAD" && sraMetadata) {
    Object.assign(st.metrics, {
      total_reads: sraMetadata.total_reads,
      total_bases: sraMetadata.total_bases,
      organism: sraMetadata.organism,
      library_layout: sraMetadata.library_layout,
      platform: sraMetadata.platform,
      study_title: sraMetadata.study_title,
    });
  }
  if (st.step_name === "TRINITY" && assemblyStats) Object.assign(st.metrics, assemblyStats);
  if (st.step_name === "TRANSDECODER_PREDICT") st.metrics.predicted_proteins = annotations.length;
  if (st.step_name === "CDD_SEARCH") {
    st.metrics.total_domains = annotations.reduce((n, a) => n + (a.cdd?.domains?.length || 0), 0);
    st.metrics.proteins_with_domains = annotations.filter((a) => a.cdd?.domains?.length).length;
  }
  if (st.step_name === "PROSTT5_PREDICT") {
    st.metrics.predictions = annotations.filter((a) => a.prostt5?.has_prediction).length;
  }
  if (st.step_name === "FOLDSEEK_SEARCH") {
    st.metrics.total_hits = annotations.reduce((n, a) => n + (a.foldseek?.hits?.length || 0), 0);
    st.metrics.proteins_with_hits = annotations.filter((a) => a.foldseek?.hits?.length).length;
  }
}

// Logs — parse the Nextflow stdout we captured to tee.
const logs = [];
if (logFile && fs.existsSync(logFile)) {
  const text = fs.readFileSync(logFile, "utf-8");
  const now = new Date();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const level = /ERROR|FAIL|Exception/i.test(line)
      ? "error"
      : /WARN/i.test(line)
      ? "warn"
      : "info";
    const m = line.match(/process\s*[>`]\s*(\w+)/i);
    const source = m ? `step:${m[1]}` : "nextflow";
    logs.push({
      timestamp: now.toISOString(),
      level,
      source,
      message: line.slice(0, 500),
    });
    // Small per-line timestamp drift so order is preserved but stamps aren't identical
    now.setMilliseconds(now.getMilliseconds() + 1);
  }
  console.log(`Parsed ${logs.length} log lines`);
}

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
console.log(`POST ${url} (payload ${(JSON.stringify(payload).length / 1024).toFixed(1)} KB)`);

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await res.text();
console.log(`HTTP ${res.status}  ${text}`);
process.exit(res.ok ? 0 : 1);
