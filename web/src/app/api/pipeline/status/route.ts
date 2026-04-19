import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pipelineRuns, pipelineSteps, pipelineLogs } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

/*
 * Pipeline status webhook. Called by Nextflow as each step starts/completes
 * (see nf-transcriptome/main.nf:sendStatusUpdate). Updates the pipeline_steps
 * table and writes any piggy-backed log lines. Does NOT read local files —
 * annotation ingest happens via /api/pipeline/ingest/[runId] (called by the
 * Nextflow runner Job at the end of the run).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { run_id, step, status, metrics, log_lines } = body as {
      run_id: string;
      step: string;
      status: string;
      metrics?: Record<string, unknown>;
      log_lines?: { level?: string; message: string }[];
    };

    if (!run_id || !step || !status) {
      return NextResponse.json(
        { error: "run_id, step, and status are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const now = new Date().toISOString();

    // Upsert step status
    const existing = await db
      .select()
      .from(pipelineSteps)
      .where(and(eq(pipelineSteps.runId, run_id), eq(pipelineSteps.stepName, step)))
      .get();

    if (existing) {
      await db
        .update(pipelineSteps)
        .set({
          status,
          completedAt: status === "completed" ? now : null,
          startedAt: existing.startedAt || now,
          metrics: metrics ? JSON.stringify(metrics) : null,
        })
        .where(eq(pipelineSteps.id, existing.id))
        .run();
    } else {
      await db
        .insert(pipelineSteps)
        .values({
          runId: run_id,
          stepName: step,
          status,
          startedAt: now,
          completedAt: status === "completed" ? now : null,
          metrics: metrics ? JSON.stringify(metrics) : null,
        })
        .run();
    }

    // SRA_DOWNLOAD metadata → run row
    if (step === "SRA_DOWNLOAD" && status === "completed" && metrics) {
      await db
        .update(pipelineRuns)
        .set({
          organism: (metrics as Record<string, string>).organism || null,
          libraryLayout: (metrics as Record<string, string>).library_layout || null,
          totalReads: (metrics as Record<string, number>).total_reads || null,
          totalBases: (metrics as Record<string, number>).total_bases || null,
          platform: (metrics as Record<string, string>).platform || null,
          studyTitle: (metrics as Record<string, string>).study_title || null,
          updatedAt: now,
        })
        .where(eq(pipelineRuns.id, run_id))
        .run();
    }

    // TRINITY stats → run row
    if (step === "TRINITY" && status === "completed" && metrics) {
      await db
        .update(pipelineRuns)
        .set({
          totalContigs: (metrics as Record<string, number>).num_contigs || null,
          n50: (metrics as Record<string, number>).n50 || null,
          updatedAt: now,
        })
        .where(eq(pipelineRuns.id, run_id))
        .run();
    }

    // Failure → mark run failed
    if (status === "failed") {
      await db
        .update(pipelineRuns)
        .set({
          status: "failed",
          errorMessage: `Step ${step} failed`,
          updatedAt: now,
        })
        .where(eq(pipelineRuns.id, run_id))
        .run();
    }

    // Piggy-backed log lines
    if (log_lines && Array.isArray(log_lines)) {
      for (const entry of log_lines) {
        await db
          .insert(pipelineLogs)
          .values({
            runId: run_id,
            timestamp: now,
            level: entry.level || "info",
            source: `step:${step}`,
            message: entry.message || "",
          })
          .run();
      }
    }

    // Always bump updatedAt
    await db
      .update(pipelineRuns)
      .set({ updatedAt: now })
      .where(eq(pipelineRuns.id, run_id))
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Status update error:", error);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
