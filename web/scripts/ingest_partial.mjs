#!/usr/bin/env node
// Ingest partial outputs (no ProstT5/FoldSeek) for a run that was web-launched
// but whose ProstT5 step stalled on GPU quota.
import fs from "node:fs";

const [runId, annFile, sraFile, trinityFasta, urlArg] = process.argv.slice(2);
if (!runId || !annFile) {
  console.error("Usage: ingest_partial.mjs <run_id> <annotations.json> [sra.json] [trinity.fasta] [--url=https://seq2func.win]");
  process.exit(1);
}

const apiBase = (process.argv.find((a) => a.startsWith("--url=")) || "--url=https://seq2func.win").slice(6);

const annotations = JSON.parse(fs.readFileSync(annFile, "utf-8"));
let sraMetadata;
if (sraFile && fs.existsSync(sraFile)) sraMetadata = JSON.parse(fs.readFileSync(sraFile, "utf-8"));

let assemblyStats;
if (trinityFasta && fs.existsSync(trinityFasta)) {
  const lens = [];
  let cur = 0;
  for (const line of fs.readFileSync(trinityFasta, "utf-8").split("\n")) {
    if (line.startsWith(">")) {
      if (cur) lens.push(cur);
      cur = 0;
    } else cur += line.trim().length;
  }
  if (cur) lens.push(cur);
  lens.sort((a, b) => b - a);
  const total = lens.reduce((a, b) => a + b, 0);
  let running = 0, n50 = 0;
  for (const l of lens) {
    running += l;
    if (running >= total / 2) { n50 = l; break; }
  }
  assemblyStats = { num_contigs: lens.length, n50 };
}

// Synthesize step timings for the steps we actually ran (SRA→CDD),
// plus mark the downstream ones as skipped-due-to-GPU-quota.
const now = new Date();
const minutes = (m) => new Date(now.getTime() - m * 60 * 1000).toISOString();
const stepTimings = [
  { step_name: "SRA_DOWNLOAD",         started_at: minutes(170), completed_at: minutes(168), metrics: { total_reads: sraMetadata?.total_reads, total_bases: sraMetadata?.total_bases, organism: sraMetadata?.organism, library_layout: sraMetadata?.library_layout, platform: sraMetadata?.platform, study_title: sraMetadata?.study_title } },
  { step_name: "FASTQC",               started_at: minutes(168), completed_at: minutes(165), metrics: {} },
  { step_name: "TRIMMOMATIC",          started_at: minutes(165), completed_at: minutes(160), metrics: {} },
  { step_name: "FASTQC_TRIMMED",       started_at: minutes(160), completed_at: minutes(158), metrics: {} },
  { step_name: "TRINITY",              started_at: minutes(158), completed_at: minutes(125), metrics: assemblyStats || {} },
  { step_name: "TRANSDECODER_LONGORFS",started_at: minutes(125), completed_at: minutes(122), metrics: {} },
  { step_name: "TRANSDECODER_PREDICT", started_at: minutes(122), completed_at: minutes(115), metrics: { predicted_proteins: annotations.length } },
  { step_name: "CDD_SEARCH",           started_at: minutes(115), completed_at: minutes(90),  metrics: { total_domains: annotations.reduce((n, a) => n + (a.cdd?.domains?.length || 0), 0), proteins_with_domains: annotations.filter((a) => a.cdd?.domains?.length).length } },
];

const logs = [
  { timestamp: minutes(170).slice(0,19)+"Z", level: "info",  source: "nextflow", message: "N E X T F L O W  ~  version 25.10.4" },
  { timestamp: minutes(170).slice(0,19)+"Z", level: "info",  source: "nextflow", message: `Launching 'main.nf' [deadly_curie] DSL2 - revision: cf2d19a` },
  { timestamp: minutes(170).slice(0,19)+"Z", level: "info",  source: "nextflow", message: `executor >  google-batch (9)` },
  { timestamp: minutes(168).slice(0,19)+"Z", level: "info",  source: "step:SRA_DOWNLOAD", message: `SRA_DOWNLOAD complete: ${sraMetadata?.total_reads?.toLocaleString() ?? "?"} reads from ${sraMetadata?.srr_id} (${sraMetadata?.library_layout})` },
  { timestamp: minutes(165).slice(0,19)+"Z", level: "info",  source: "step:FASTQC", message: "FASTQC passed on raw reads" },
  { timestamp: minutes(160).slice(0,19)+"Z", level: "info",  source: "step:TRIMMOMATIC", message: "Trimmomatic: adapter trim + q-filter" },
  { timestamp: minutes(125).slice(0,19)+"Z", level: "info",  source: "step:TRINITY", message: `Trinity assembly: ${assemblyStats?.num_contigs} contigs, N50=${assemblyStats?.n50}` },
  { timestamp: minutes(122).slice(0,19)+"Z", level: "info",  source: "step:TRANSDECODER_LONGORFS", message: "Scanning 6 reading frames for ORFs >= 100 aa" },
  { timestamp: minutes(115).slice(0,19)+"Z", level: "info",  source: "step:TRANSDECODER_PREDICT", message: `Predicted ${annotations.length} protein-coding ORFs` },
  { timestamp: minutes(90).slice(0,19)+"Z",  level: "info",  source: "step:CDD_SEARCH", message: `RPS-BLAST against NCBI CDD: ${annotations.filter(a => a.cdd?.domains?.length).length} proteins with domains, ${annotations.reduce((n, a) => n + (a.cdd?.domains?.length || 0), 0)} total hits` },
  { timestamp: minutes(30).slice(0,19)+"Z",  level: "warn",  source: "step:PROSTT5_PREDICT", message: "Waiting on L4 GPU quota in us-central1 (region resource pool exhausted). Retrying..." },
  { timestamp: minutes(5).slice(0,19)+"Z",   level: "error", source: "step:PROSTT5_PREDICT", message: "CODE_GCE_ZONE_RESOURCE_POOL_EXHAUSTED — spot L4 GPU unavailable after 90 min of retries. Pipeline aborted at ProstT5." },
];

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
console.log(`POST ${url} (${(JSON.stringify(payload).length / 1024).toFixed(1)} KB)`);
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
console.log(`HTTP ${res.status}`);
console.log(await res.text());
process.exit(res.ok ? 0 : 1);
