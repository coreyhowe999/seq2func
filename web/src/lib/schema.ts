import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ── Pipeline Runs ──────────────────────────────────────────────────────────
export const pipelineRuns = sqliteTable("pipeline_runs", {
  id: text("id").primaryKey(),                                    // run_id from Nextflow
  srrId: text("srr_id").notNull(),                                // SRA accession ID
  sampleName: text("sample_name"),                                // User-friendly name
  organism: text("organism"),                                     // Organism from SRA metadata
  libraryLayout: text("library_layout"),                          // PAIRED or SINGLE
  totalReads: integer("total_reads"),                              // Read count from SRA metadata
  totalBases: integer("total_bases"),                              // Total bases from metadata
  platform: text("platform"),                                     // Sequencing platform
  studyTitle: text("study_title"),                                // Study title from SRA
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  status: text("status").notNull().default("pending"),             // pending, running, completed, failed
  r2OutputKey: text("r2_output_key"),                              // R2 object key for output
  logR2Key: text("log_r2_key"),                                    // R2 key for archived log file
  totalContigs: integer("total_contigs"),                          // Assembly stats
  totalProteins: integer("total_proteins"),                        // Predicted protein count
  n50: integer("n50"),                                             // Assembly N50
  errorMessage: text("error_message"),                             // Error details if failed
});

// ── Pipeline Steps ─────────────────────────────────────────────────────────
export const pipelineSteps = sqliteTable(
  "pipeline_steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull().references(() => pipelineRuns.id),
    stepName: text("step_name").notNull(),                         // FASTQC, TRINITY, etc.
    status: text("status").notNull().default("pending"),            // pending, running, completed, failed, skipped
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    metrics: text("metrics"),                                      // JSON string
  },
  (table) => ({
    uniqueRunStep: uniqueIndex("idx_unique_run_step").on(table.runId, table.stepName),
    runIdx: index("idx_steps_run").on(table.runId),
  })
);

// ── Proteins ───────────────────────────────────────────────────────────────
export const proteins = sqliteTable(
  "proteins",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull().references(() => pipelineRuns.id),
    proteinId: text("protein_id").notNull(),                       // TRINITY_DN100_c0_g1_i1.p1
    transcriptId: text("transcript_id").notNull(),                 // TRINITY_DN100_c0_g1_i1
    sequence: text("sequence").notNull(),                          // Full amino acid sequence
    length: integer("length").notNull(),
    orfType: text("orf_type").notNull(),                           // complete, 5prime_partial, etc.
  },
  (table) => ({
    uniqueRunProtein: uniqueIndex("idx_unique_run_protein").on(table.runId, table.proteinId),
    runIdx: index("idx_proteins_run").on(table.runId),
  })
);

// ── CDD Domains ────────────────────────────────────────────────────────────
export const cddDomains = sqliteTable(
  "cdd_domains",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proteinId: integer("protein_id").notNull().references(() => proteins.id),
    accession: text("accession").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    superfamily: text("superfamily"),
    evalue: real("evalue").notNull(),
    bitscore: real("bitscore").notNull(),
    startPos: integer("start_pos").notNull(),
    endPos: integer("end_pos").notNull(),
  },
  (table) => ({
    proteinIdx: index("idx_cdd_protein").on(table.proteinId),
  })
);

// ── CDD Sites ──────────────────────────────────────────────────────────────
export const cddSites = sqliteTable("cdd_sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  proteinId: integer("protein_id").notNull().references(() => proteins.id),
  siteType: text("site_type").notNull(),
  residues: text("residues").notNull(),                            // JSON array
  description: text("description"),
});

// ── FoldSeek Hits ──────────────────────────────────────────────────────────
export const foldseekHits = sqliteTable(
  "foldseek_hits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    proteinId: integer("protein_id").notNull().references(() => proteins.id),
    targetId: text("target_id").notNull(),
    targetName: text("target_name"),
    identity: real("identity"),
    evalue: real("evalue"),
    alignmentLength: integer("alignment_length"),
    taxonomy: text("taxonomy"),
  },
  (table) => ({
    proteinIdx: index("idx_foldseek_protein").on(table.proteinId),
  })
);

// ── ProstT5 Predictions ───────────────────────────────────────────────────
export const prostt5Predictions = sqliteTable("prostt5_predictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  proteinId: integer("protein_id").notNull().references(() => proteins.id),
  sequence3di: text("sequence_3di").notNull(),
});

// ── Pipeline Logs ─────────────────────────────────────────────────────────
export const pipelineLogs = sqliteTable(
  "pipeline_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull().references(() => pipelineRuns.id),
    timestamp: text("timestamp").notNull(),
    level: text("level").notNull().default("info"),           // info, warn, error, debug
    source: text("source").notNull().default("nextflow"),     // nextflow, step:<STEP_NAME>
    message: text("message").notNull(),
  },
  (table) => ({
    runIdx: index("idx_logs_run").on(table.runId),
    runTimestampIdx: index("idx_logs_run_ts").on(table.runId, table.timestamp),
  })
);
