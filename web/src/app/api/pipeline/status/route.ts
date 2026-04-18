import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pipelineRuns, pipelineSteps, pipelineLogs, proteins, cddDomains, cddSites, foldseekHits, prostt5Predictions } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import type { ProteinAnnotation } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { run_id, step, status, timestamp, metrics, log_lines } = body;

    if (!run_id || !step || !status) {
      return NextResponse.json(
        { error: "run_id, step, and status are required" },
        { status: 400 }
      );
    }

    // Update the pipeline step status
    const now = new Date().toISOString();

    // Try to update existing step
    const existing = db.select()
      .from(pipelineSteps)
      .where(and(eq(pipelineSteps.runId, run_id), eq(pipelineSteps.stepName, step)))
      .get();

    if (existing) {
      db.update(pipelineSteps)
        .set({
          status: status,
          completedAt: status === "completed" ? now : null,
          startedAt: existing.startedAt || now,
          metrics: metrics ? JSON.stringify(metrics) : null,
        })
        .where(eq(pipelineSteps.id, existing.id))
        .run();
    } else {
      db.insert(pipelineSteps).values({
        runId: run_id,
        stepName: step,
        status: status,
        startedAt: now,
        completedAt: status === "completed" ? now : null,
        metrics: metrics ? JSON.stringify(metrics) : null,
      }).run();
    }

    // Handle SRA_DOWNLOAD completion — update run metadata
    if (step === "SRA_DOWNLOAD" && status === "completed" && metrics) {
      db.update(pipelineRuns)
        .set({
          organism: metrics.organism || null,
          libraryLayout: metrics.library_layout || null,
          totalReads: metrics.total_reads || null,
          totalBases: metrics.total_bases || null,
          platform: metrics.platform || null,
          studyTitle: metrics.study_title || null,
          updatedAt: now,
        })
        .where(eq(pipelineRuns.id, run_id))
        .run();
    }

    // Handle TRINITY completion — update assembly stats
    if (step === "TRINITY" && status === "completed" && metrics) {
      db.update(pipelineRuns)
        .set({
          totalContigs: metrics.num_contigs || null,
          n50: metrics.n50 || null,
          updatedAt: now,
        })
        .where(eq(pipelineRuns.id, run_id))
        .run();
    }

    // Handle MERGE_RESULTS completion — load annotations into D1
    if (step === "MERGE_RESULTS" && status === "completed") {
      // The metrics_path or a known output location contains annotations.json
      const pipelineDir = process.env.PIPELINE_DIR || path.join(process.cwd(), "..", "nf-transcriptome");
      const annotationsPath = path.join(pipelineDir, "results", run_id, "annotations", "annotations.json");

      if (fs.existsSync(annotationsPath)) {
        try {
          const annotationsJson = fs.readFileSync(annotationsPath, "utf-8");
          const annotations: ProteinAnnotation[] = JSON.parse(annotationsJson);

          // Bulk insert annotations into the database
          for (const ann of annotations) {
            // Insert protein
            const proteinResult = db.insert(proteins).values({
              runId: run_id,
              proteinId: ann.protein_id,
              transcriptId: ann.transcript_id,
              sequence: ann.sequence,
              length: ann.length,
              orfType: ann.orf_type,
            }).returning().get();

            const proteinDbId = proteinResult.id;

            // Insert CDD domains
            for (const domain of ann.cdd?.domains || []) {
              db.insert(cddDomains).values({
                proteinId: proteinDbId,
                accession: domain.accession,
                name: domain.name,
                description: domain.description || "",
                superfamily: domain.superfamily || "",
                evalue: domain.evalue,
                bitscore: domain.bitscore,
                startPos: domain.from,
                endPos: domain.to,
              }).run();
            }

            // Insert CDD sites
            for (const site of ann.cdd?.sites || []) {
              db.insert(cddSites).values({
                proteinId: proteinDbId,
                siteType: site.type,
                residues: JSON.stringify(site.residues),
                description: site.description || "",
              }).run();
            }

            // Insert FoldSeek hits
            for (const hit of ann.foldseek?.hits || []) {
              db.insert(foldseekHits).values({
                proteinId: proteinDbId,
                targetId: hit.target_id,
                targetName: hit.target_name || "",
                identity: hit.identity,
                evalue: hit.evalue,
                alignmentLength: hit.alignment_length,
                taxonomy: hit.taxonomy || "",
              }).run();
            }

            // Insert ProstT5 prediction
            if (ann.prostt5?.has_prediction && ann.prostt5?.sequence_3di) {
              db.insert(prostt5Predictions).values({
                proteinId: proteinDbId,
                sequence3di: ann.prostt5.sequence_3di,
              }).run();
            }
          }

          // Update run as completed
          db.update(pipelineRuns)
            .set({
              status: "completed",
              totalProteins: annotations.length,
              updatedAt: now,
            })
            .where(eq(pipelineRuns.id, run_id))
            .run();

          console.log(`Loaded ${annotations.length} protein annotations for run ${run_id}`);
        } catch (err) {
          console.error(`Failed to load annotations for run ${run_id}:`, err);
        }
      } else {
        // Mark as completed even if annotations file isn't found yet
        db.update(pipelineRuns)
          .set({ status: "completed", updatedAt: now })
          .where(eq(pipelineRuns.id, run_id))
          .run();
      }
    }

    // Handle failure
    if (status === "failed") {
      db.update(pipelineRuns)
        .set({
          status: "failed",
          errorMessage: `Step ${step} failed`,
          updatedAt: now,
        })
        .where(eq(pipelineRuns.id, run_id))
        .run();
    }

    // Insert any log lines sent with the status update
    if (log_lines && Array.isArray(log_lines)) {
      for (const entry of log_lines) {
        db.insert(pipelineLogs).values({
          runId: run_id,
          timestamp: now,
          level: entry.level || "info",
          source: `step:${step}`,
          message: entry.message || "",
        }).run();
      }
    }

    // Always update the run's updatedAt
    db.update(pipelineRuns)
      .set({ updatedAt: now })
      .where(eq(pipelineRuns.id, run_id))
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Status update error:", error);
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 }
    );
  }
}
