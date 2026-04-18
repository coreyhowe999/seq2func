-- Migration: 0001_initial
-- Complete database schema for the transcriptome pipeline web app
-- Compatible with both local SQLite and Cloudflare D1

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    srr_id TEXT NOT NULL,
    sample_name TEXT,
    organism TEXT,
    library_layout TEXT,
    total_reads INTEGER,
    total_bases INTEGER,
    platform TEXT,
    study_title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'pending',
    r2_output_key TEXT,
    log_r2_key TEXT,
    total_contigs INTEGER,
    total_proteins INTEGER,
    n50 INTEGER,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
    step_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    metrics TEXT,
    UNIQUE(run_id, step_name)
);

CREATE TABLE IF NOT EXISTS proteins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
    protein_id TEXT NOT NULL,
    transcript_id TEXT NOT NULL,
    sequence TEXT NOT NULL,
    length INTEGER NOT NULL,
    orf_type TEXT NOT NULL,
    UNIQUE(run_id, protein_id)
);

CREATE TABLE IF NOT EXISTS cdd_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protein_id INTEGER NOT NULL REFERENCES proteins(id),
    accession TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    superfamily TEXT,
    evalue REAL NOT NULL,
    bitscore REAL NOT NULL,
    start_pos INTEGER NOT NULL,
    end_pos INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cdd_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protein_id INTEGER NOT NULL REFERENCES proteins(id),
    site_type TEXT NOT NULL,
    residues TEXT NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS foldseek_hits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protein_id INTEGER NOT NULL REFERENCES proteins(id),
    target_id TEXT NOT NULL,
    target_name TEXT,
    identity REAL,
    evalue REAL,
    alignment_length INTEGER,
    taxonomy TEXT
);

CREATE TABLE IF NOT EXISTS prostt5_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    protein_id INTEGER NOT NULL REFERENCES proteins(id),
    sequence_3di TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    source TEXT NOT NULL DEFAULT 'nextflow',
    message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proteins_run ON proteins(run_id);
CREATE INDEX IF NOT EXISTS idx_cdd_protein ON cdd_domains(protein_id);
CREATE INDEX IF NOT EXISTS idx_foldseek_protein ON foldseek_hits(protein_id);
CREATE INDEX IF NOT EXISTS idx_steps_run ON pipeline_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_logs_run ON pipeline_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_logs_run_ts ON pipeline_logs(run_id, timestamp);
