import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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
    const effectiveSrrId = srrId || sraMetadata?.srr_id || runId;
    const effectiveSampleName = sampleName || effectiveSrrId;

    if (!Array.isArray(annotations)) {
      return NextResponse.json(
        { error: "Body must include an 'annotations' array" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // Ensure run exists — create if missing (for runs launched outside the web UI)
    const existingRun = db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, runId))
      .get();

    if (!existingRun) {
      db.insert(pipelineRuns)
        .values({
          id: runId,
          srrId: effectiveSrrId,
          sampleName: effectiveSampleName,
          status: "completed",
        })
        .run();

      for (const stepName of PIPELINE_STEPS) {
        db.insert(pipelineSteps)
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
    const existingProteinIds = db
      .select({ id: proteins.id })
      .from(proteins)
      .where(eq(proteins.runId, runId))
      .all()
      .map((p) => p.id);

    if (existingProteinIds.length > 0) {
      db.delete(cddDomains).where(inArray(cddDomains.proteinId, existingProteinIds)).run();
      db.delete(cddSites).where(inArray(cddSites.proteinId, existingProteinIds)).run();
      db.delete(foldseekHits).where(inArray(foldseekHits.proteinId, existingProteinIds)).run();
      db.delete(prostt5Predictions).where(inArray(prostt5Predictions.proteinId, existingProteinIds)).run();
      db.delete(proteins).where(eq(proteins.runId, runId)).run();
    }

    // Insert proteins + nested annotations
    for (const ann of annotations) {
      const inserted = db
        .insert(proteins)
        .values({
          runId,
          proteinId: ann.protein_id,
          transcriptId: ann.transcript_id,
          sequence: ann.sequence,
          length: ann.length,
          orfType: ann.orf_type,
        })
        .returning()
        .get();

      const pid = inserted.id;

      for (const d of ann.cdd?.domains || []) {
        db.insert(cddDomains)
          .values({
            proteinId: pid,
            accession: d.accession,
            name: d.name,
            description: d.description || "",
            superfamily: d.superfamily || "",
            evalue: d.evalue,
            bitscore: d.bitscore,
            startPos: d.from,
            endPos: d.to,
          })
          .run();
      }

      for (const s of ann.cdd?.sites || []) {
        db.insert(cddSites)
          .values({
            proteinId: pid,
            siteType: s.type,
            residues: JSON.stringify(s.residues),
            description: s.description || "",
          })
          .run();
      }

      for (const h of ann.foldseek?.hits || []) {
        db.insert(foldseekHits)
          .values({
            proteinId: pid,
            targetId: h.target_id,
            targetName: h.target_name || "",
            identity: h.identity,
            evalue: h.evalue,
            alignmentLength: h.alignment_length,
            taxonomy: h.taxonomy || "",
          })
          .run();
      }

      if (ann.prostt5?.has_prediction && ann.prostt5?.sequence_3di) {
        db.insert(prostt5Predictions)
          .values({
            proteinId: pid,
            sequence3di: ann.prostt5.sequence_3di,
          })
          .run();
      }
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

    db.update(pipelineRuns).set(runUpdate).where(eq(pipelineRuns.id, runId)).run();

    // Apply per-step timings + metrics if provided; otherwise mark all completed
    if (stepTimings && stepTimings.length > 0) {
      for (const st of stepTimings) {
        const update: Record<string, unknown> = { status: "completed" };
        if (st.started_at) update.startedAt = st.started_at;
        if (st.completed_at) update.completedAt = st.completed_at;
        if (st.metrics) update.metrics = JSON.stringify(st.metrics);

        const existingStep = db
          .select()
          .from(pipelineSteps)
          .where(and(eq(pipelineSteps.runId, runId), eq(pipelineSteps.stepName, st.step_name)))
          .get();

        if (existingStep) {
          db.update(pipelineSteps).set(update).where(eq(pipelineSteps.id, existingStep.id)).run();
        } else {
          db.insert(pipelineSteps)
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
      db.update(pipelineSteps)
        .set({ status: "completed", completedAt: now })
        .where(eq(pipelineSteps.runId, runId))
        .run();
    }

    // Ingest logs if provided (idempotent: wipe + insert)
    if (logs && logs.length > 0) {
      db.delete(pipelineLogs).where(eq(pipelineLogs.runId, runId)).run();
      for (const entry of logs) {
        db.insert(pipelineLogs)
          .values({
            runId,
            timestamp: entry.timestamp,
            level: entry.level || "info",
            source: entry.source || "nextflow",
            message: entry.message,
          })
          .run();
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
