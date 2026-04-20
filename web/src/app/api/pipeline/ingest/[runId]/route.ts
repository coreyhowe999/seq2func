import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  pipelineRuns,
  pipelineSteps,
  pipelineLogs,
  proteins,
  cddDomains,
  cddSites,
  foldseekHits,
  prostt5Predictions,
} from "@/lib/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { ProteinAnnotation } from "@/lib/types";

export const runtime = "edge";

interface IngestBody {
  annotations: ProteinAnnotation[];
  srrId?: string;
  sampleName?: string;
  sraMetadata?: {
    srr_id?: string;
    organism?: string;
    library_layout?: string;
    total_reads?: number;
    total_bases?: number;
    platform?: string;
    study_title?: string;
  };
  assemblyStats?: {
    num_contigs?: number;
    n50?: number;
  };
  stepTimings?: {
    step_name: string;
    started_at?: string;
    completed_at?: string;
    metrics?: Record<string, unknown>;
  }[];
  logs?: {
    timestamp: string;
    level?: string;
    source?: string;
    message: string;
  }[];
}

const PIPELINE_STEPS = [
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
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const body = (await request.json()) as IngestBody;
    const { annotations, srrId, sampleName, sraMetadata, assemblyStats, stepTimings, logs } = body;

    if (!Array.isArray(annotations)) {
      return NextResponse.json(
        { error: "Body must include an 'annotations' array" },
        { status: 400 }
      );
    }

    const db = getDb();
    const now = new Date().toISOString();
    const effectiveSrrId = srrId || sraMetadata?.srr_id || runId;
    const effectiveSampleName = sampleName || effectiveSrrId;

    // Ensure run exists — create if missing (for runs launched outside the web UI)
    const existingRun = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, runId))
      .get();

    if (!existingRun) {
      await db
        .insert(pipelineRuns)
        .values({
          id: runId,
          srrId: effectiveSrrId,
          sampleName: effectiveSampleName,
          status: "completed",
        })
        .run();

      for (const stepName of PIPELINE_STEPS) {
        await db
          .insert(pipelineSteps)
          .values({
            runId,
            stepName,
            status: "completed",
            startedAt: now,
            completedAt: now,
          })
          .run();
      }
    }

    // Idempotent: clear any existing annotation data for this run
    const existingProteinRows = await db
      .select({ id: proteins.id })
      .from(proteins)
      .where(eq(proteins.runId, runId))
      .all();
    const existingProteinIds = existingProteinRows.map((p) => p.id);

    if (existingProteinIds.length > 0) {
      await db.delete(cddDomains).where(inArray(cddDomains.proteinId, existingProteinIds)).run();
      await db.delete(cddSites).where(inArray(cddSites.proteinId, existingProteinIds)).run();
      await db.delete(foldseekHits).where(inArray(foldseekHits.proteinId, existingProteinIds)).run();
      await db
        .delete(prostt5Predictions)
        .where(inArray(prostt5Predictions.proteinId, existingProteinIds))
        .run();
      await db.delete(proteins).where(eq(proteins.runId, runId)).run();
    }

    // Bulk-insert proteins, then bulk-insert each child table using the
    // returned IDs. D1/Workers caps subrequests per invocation, so use a few
    // large `.values([...])` calls instead of per-row statements. Chunking
    // size chosen to keep each SQL statement under D1's 100kB-ish limit.
    // D1 caps ~100 bound params per statement, and Workers cap ~50
    // subrequests per invocation. Strategy: small per-statement chunks,
    // grouped into a single subrequest via d1.batch().
    const PROTEIN_CHUNK = 15; // 15 * 6 cols = 90 params
    const CHILD_CHUNK = 10;   // 10 * 9 cols = 90 params
    const BATCH_GROUP = 30;   // statements grouped into one subrequest

    const proteinIdByProteinId: Record<string, number> = {};

    for (let i = 0; i < annotations.length; i += PROTEIN_CHUNK) {
      const batch = annotations.slice(i, i + PROTEIN_CHUNK);
      const inserted = await db
        .insert(proteins)
        .values(
          batch.map((ann) => ({
            runId,
            proteinId: ann.protein_id,
            transcriptId: ann.transcript_id,
            sequence: ann.sequence,
            length: ann.length,
            orfType: ann.orf_type,
          }))
        )
        .returning()
        .all();
      for (const row of inserted) proteinIdByProteinId[row.proteinId] = row.id;
    }

    // Flatten child rows, then chunk-insert.
    const domainRows: (typeof cddDomains.$inferInsert)[] = [];
    const siteRows: (typeof cddSites.$inferInsert)[] = [];
    const hitRows: (typeof foldseekHits.$inferInsert)[] = [];
    const prostt5Rows: (typeof prostt5Predictions.$inferInsert)[] = [];

    for (const ann of annotations) {
      const pid = proteinIdByProteinId[ann.protein_id];
      if (pid == null) continue;
      for (const d of ann.cdd?.domains || []) {
        domainRows.push({
          proteinId: pid,
          accession: d.accession,
          name: d.name,
          description: d.description || "",
          superfamily: d.superfamily || "",
          evalue: d.evalue,
          bitscore: d.bitscore,
          startPos: d.from,
          endPos: d.to,
        });
      }
      for (const s of ann.cdd?.sites || []) {
        siteRows.push({
          proteinId: pid,
          siteType: s.type,
          residues: JSON.stringify(s.residues),
          description: s.description || "",
        });
      }
      for (const h of ann.foldseek?.hits || []) {
        hitRows.push({
          proteinId: pid,
          targetId: h.target_id,
          targetName: h.target_name || "",
          identity: h.identity,
          evalue: h.evalue,
          alignmentLength: h.alignment_length,
          taxonomy: h.taxonomy || "",
        });
      }
      if (ann.prostt5?.has_prediction && ann.prostt5?.sequence_3di) {
        prostt5Rows.push({ proteinId: pid, sequence3di: ann.prostt5.sequence_3di });
      }
    }

    // Build a single flat list of INSERT statements, then ship them in
    // groups of BATCH_GROUP via d1.batch() so each group = 1 subrequest.
    type Stmt = ReturnType<ReturnType<typeof db.insert>["values"]>;
    const stmts: Stmt[] = [];

    for (let i = 0; i < domainRows.length; i += CHILD_CHUNK) {
      const c = domainRows.slice(i, i + CHILD_CHUNK);
      if (c.length > 0) stmts.push(db.insert(cddDomains).values(c));
    }
    for (let i = 0; i < siteRows.length; i += CHILD_CHUNK) {
      const c = siteRows.slice(i, i + CHILD_CHUNK);
      if (c.length > 0) stmts.push(db.insert(cddSites).values(c));
    }
    for (let i = 0; i < hitRows.length; i += CHILD_CHUNK) {
      const c = hitRows.slice(i, i + CHILD_CHUNK);
      if (c.length > 0) stmts.push(db.insert(foldseekHits).values(c));
    }
    for (let i = 0; i < prostt5Rows.length; i += CHILD_CHUNK) {
      const c = prostt5Rows.slice(i, i + CHILD_CHUNK);
      if (c.length > 0) stmts.push(db.insert(prostt5Predictions).values(c));
    }

    for (let i = 0; i < stmts.length; i += BATCH_GROUP) {
      const group = stmts.slice(i, i + BATCH_GROUP);
      if (group.length === 0) continue;
      // drizzle D1 batch expects a non-empty tuple; cast is fine here.
      // @ts-expect-error drizzle batch overloads need a tuple type
      await db.batch(group);
    }

    // Update run: mark completed, set totals, clear stale error
    const runUpdate: Record<string, unknown> = {
      status: "completed",
      totalProteins: annotations.length,
      errorMessage: null,
      updatedAt: now,
    };

    if (srrId) runUpdate.srrId = srrId;
    if (sampleName) runUpdate.sampleName = sampleName;

    if (sraMetadata) {
      if (sraMetadata.srr_id) runUpdate.srrId = sraMetadata.srr_id;
      if (sraMetadata.organism) runUpdate.organism = sraMetadata.organism;
      if (sraMetadata.library_layout) runUpdate.libraryLayout = sraMetadata.library_layout;
      if (sraMetadata.total_reads != null) runUpdate.totalReads = sraMetadata.total_reads;
      if (sraMetadata.total_bases != null) runUpdate.totalBases = sraMetadata.total_bases;
      if (sraMetadata.platform) runUpdate.platform = sraMetadata.platform;
      if (sraMetadata.study_title) runUpdate.studyTitle = sraMetadata.study_title;
    }

    if (assemblyStats) {
      if (assemblyStats.num_contigs != null) runUpdate.totalContigs = assemblyStats.num_contigs;
      if (assemblyStats.n50 != null) runUpdate.n50 = assemblyStats.n50;
    }

    await db.update(pipelineRuns).set(runUpdate).where(eq(pipelineRuns.id, runId)).run();

    // Apply per-step timings + metrics if provided
    if (stepTimings && stepTimings.length > 0) {
      for (const st of stepTimings) {
        const update: Record<string, unknown> = { status: "completed" };
        if (st.started_at) update.startedAt = st.started_at;
        if (st.completed_at) update.completedAt = st.completed_at;
        if (st.metrics) update.metrics = JSON.stringify(st.metrics);

        const existingStep = await db
          .select()
          .from(pipelineSteps)
          .where(and(eq(pipelineSteps.runId, runId), eq(pipelineSteps.stepName, st.step_name)))
          .get();

        if (existingStep) {
          await db.update(pipelineSteps).set(update).where(eq(pipelineSteps.id, existingStep.id)).run();
        } else {
          await db
            .insert(pipelineSteps)
            .values({
              runId,
              stepName: st.step_name,
              status: "completed",
              startedAt: st.started_at ?? now,
              completedAt: st.completed_at ?? now,
              metrics: st.metrics ? JSON.stringify(st.metrics) : null,
            })
            .run();
        }
      }
    } else {
      await db
        .update(pipelineSteps)
        .set({ status: "completed", completedAt: now })
        .where(eq(pipelineSteps.runId, runId))
        .run();
    }

    // Ingest logs (idempotent: wipe + grouped batch insert)
    if (logs && logs.length > 0) {
      await db.delete(pipelineLogs).where(eq(pipelineLogs.runId, runId)).run();
      const LOG_CHUNK = 15; // 15 * 5 cols = 75 params
      const logStmts: Stmt[] = [];
      for (let i = 0; i < logs.length; i += LOG_CHUNK) {
        const chunk = logs.slice(i, i + LOG_CHUNK).map((e) => ({
          runId,
          timestamp: e.timestamp,
          level: e.level || "info",
          source: e.source || "nextflow",
          message: e.message,
        }));
        if (chunk.length > 0) logStmts.push(db.insert(pipelineLogs).values(chunk));
      }
      for (let i = 0; i < logStmts.length; i += BATCH_GROUP) {
        const group = logStmts.slice(i, i + BATCH_GROUP);
        if (group.length === 0) continue;
        // @ts-expect-error drizzle batch overloads need a tuple type
        await db.batch(group);
      }
    }

    return NextResponse.json({
      success: true,
      runId,
      proteinCount: annotations.length,
    });
  } catch (error) {
    console.error("Ingest error:", error);
    return NextResponse.json(
      { error: "Failed to ingest annotations", detail: String(error) },
      { status: 500 }
    );
  }
}
