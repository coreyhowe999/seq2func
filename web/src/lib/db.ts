import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

// Type that works for both better-sqlite3 and D1 Drizzle instances
type DrizzleDB = BetterSQLite3Database<typeof schema>;

let _db: DrizzleDB | null = null;
let _initialized = false;

function getDbPath(): string {
  return process.env.LOCAL_DB_PATH || path.join(process.cwd(), "data", "local.db");
}

const INIT_SQL = `
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
`;

function createDatabase(): DrizzleDB {
  const dbPath = getDbPath();

  // Ensure the data directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");

  const database = drizzle(sqlite, { schema });

  if (!_initialized) {
    sqlite.exec(INIT_SQL);
    _initialized = true;
  }

  return database;
}

// Lazy singleton — only creates the DB connection when first accessed at runtime
export const db = new Proxy({} as DrizzleDB, {
  get(_target, prop) {
    if (!_db) {
      _db = createDatabase();
    }
    return (_db as any)[prop];
  },
});

// For Cloudflare D1: export a function that creates a D1-backed Drizzle instance
// Usage in Cloudflare Workers: const db = getD1Database(env.DB)
export function getD1Database(d1Binding: any) {
  // Dynamic import to avoid bundling D1 driver in local builds
  const { drizzle: drizzleD1 } = require("drizzle-orm/d1");
  return drizzleD1(d1Binding, { schema });
}
