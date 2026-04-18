// ── Pipeline Run Types ─────────────────────────────────────────────────────

export interface PipelineRun {
  id: string;
  srrId: string;
  sampleName: string | null;
  organism: string | null;
  libraryLayout: string | null;
  totalReads: number | null;
  totalBases: number | null;
  platform: string | null;
  studyTitle: string | null;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "running" | "completed" | "failed";
  totalContigs: number | null;
  totalProteins: number | null;
  n50: number | null;
  errorMessage: string | null;
  steps?: PipelineStep[];
  stepCounts?: StepCounts;
}

export interface PipelineStep {
  id: number;
  runId: string;
  stepName: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt: string | null;
  completedAt: string | null;
  metrics: string | null;
}

export interface StepCounts {
  total: number;
  completed: number;
  running: number;
  pending: number;
  failed: number;
  skipped: number;
}

// ── Protein Annotation Types ──────────────────────────────────────────────

export interface ProteinAnnotation {
  protein_id: string;
  sequence: string;
  length: number;
  orf_type: "complete" | "5prime_partial" | "3prime_partial" | "internal" | string;
  transcript_id: string;
  cdd: CddAnnotation;
  prostt5: ProstT5Annotation;
  foldseek: FoldseekAnnotation;
}

export interface CddAnnotation {
  domains: CddDomain[];
  sites: CddSite[];
}

export interface CddDomain {
  accession: string;
  name: string;
  description: string;
  superfamily: string;
  evalue: number;
  bitscore: number;
  from: number;
  to: number;
}

export interface CddSite {
  type: string;
  residues: string[];
  description: string;
}

export interface ProstT5Annotation {
  sequence_3di: string;
  has_prediction: boolean;
}

export interface FoldseekAnnotation {
  hits: FoldseekHit[];
}

export interface FoldseekHit {
  target_id: string;
  target_name: string;
  identity: number;
  evalue: number;
  alignment_length: number;
  taxonomy: string;
}

// ── API Request/Response Types ────────────────────────────────────────────

export interface LaunchRequest {
  srrId: string;
  sampleName?: string;
  runId: string;
}

export interface StatusUpdate {
  run_id: string;
  step: string;
  status: string;
  timestamp: string;
  metrics?: Record<string, unknown>;
  log_lines?: { level: string; message: string }[];
}

// ── Log Types ─────────────────────────────────────────────────────────────

export interface LogEntry {
  id: number;
  runId: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
}

export interface ResultsResponse {
  proteins: ProteinAnnotation[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Pipeline Step Definitions ─────────────────────────────────────────────

export const PIPELINE_STEPS = [
  "SRA_DOWNLOAD",
  "FASTQC",
  "TRIMMOMATIC",
  "FASTQC_TRIMMED",
  "TRINITY",
  "TRANSDECODER_LONGORFS",
  "TRANSDECODER_PREDICT",
  "CDD_SEARCH",
  "PROSTT5_PREDICT",
  "FOLDSEEK_SEARCH",
  "MERGE_RESULTS",
] as const;

export type PipelineStepName = (typeof PIPELINE_STEPS)[number];
