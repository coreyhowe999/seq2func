import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pipelineRuns, pipelineSteps } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { PIPELINE_STEPS } from "@/lib/types";
import { getGcpAccessToken } from "@/lib/gcp_auth";
import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

/*
 * Pipeline launch endpoint.
 *
 * Creates the run + pending step rows in D1, then triggers the
 * `seq2func-nextflow` Cloud Run Job with the SRR_ID and RUN_ID as env
 * overrides. The Job's container runs `nextflow run main.nf -profile gcp` for
 * ~20-30 min; each step's status is POSTed back to /api/pipeline/status, and
 * the final annotations are POSTed to /api/pipeline/ingest/<runId>.
 *
 * Required environment (set via wrangler.toml [vars] or Cloudflare secrets):
 *   GCP_PROJECT_ID      — e.g. "seq2func"
 *   GCP_REGION          — e.g. "us-central1"
 *   NEXTFLOW_JOB_NAME   — e.g. "seq2func-nextflow"
 *   GCP_OAUTH_TOKEN     — OAuth access token with run.jobs.run permission
 *                         (refreshed out-of-band; short-lived)
 */

const SRR_REGEX = /^[SDE]RR\d{6,}$/;

const FOLDSEEK_DB_MAP: Record<string, string> = {
  pdb: "foldseek/pdb/pdb",
  swissprot: "foldseek/swissprot/swissprot",
  proteome: "foldseek/proteome/proteome",
  uniprot50: "foldseek/uniprot50/uniprot50",
};

async function triggerCloudRunJob(opts: {
  project: string;
  region: string;
  jobName: string;
  token: string;
  env: Record<string, string>;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `https://run.googleapis.com/v2/projects/${opts.project}/locations/${opts.region}/jobs/${opts.jobName}:run`;

  // Override the container's env so the Job knows which SRR + run_id to use.
  // Cloud Run Jobs API accepts `overrides.containerOverrides[].env` at run time.
  const payload = {
    overrides: {
      containerOverrides: [
        {
          env: Object.entries(opts.env).map(([name, value]) => ({ name, value })),
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { srrId, sampleName, runId, profile, foldseekDb } = body as {
      srrId?: string;
      sampleName?: string;
      runId?: string;
      profile?: string;
      foldseekDb?: string;
    };

    if (!srrId || !SRR_REGEX.test(srrId)) {
      return NextResponse.json(
        { error: "Invalid SRA accession ID. Must match format: SRR/ERR/DRR followed by 6+ digits." },
        { status: 400 }
      );
    }
    if (!runId) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    const db = getDb();

    // Create the run + pending step rows up front so the UI can start polling
    // immediately.
    await db
      .insert(pipelineRuns)
      .values({
        id: runId,
        srrId,
        sampleName: sampleName || srrId,
        status: "pending",
      })
      .run();

    for (const stepName of PIPELINE_STEPS) {
      await db
        .insert(pipelineSteps)
        .values({
          runId,
          stepName,
          status: "pending",
        })
        .run();
    }

    // Pages bindings + secrets come through getRequestContext().env.
    const { env } = getRequestContext();
    const typedEnv = env as unknown as {
      GCP_PROJECT_ID?: string;
      GCP_REGION?: string;
      NEXTFLOW_JOB_NAME?: string;
      GCP_SA_KEY?: string;
    };
    const project = typedEnv.GCP_PROJECT_ID || "seq2func";
    const region = typedEnv.GCP_REGION || "us-central1";
    const jobName = typedEnv.NEXTFLOW_JOB_NAME || "seq2func-nextflow";
    const saKey = typedEnv.GCP_SA_KEY;

    if (!saKey) {
      await db
        .update(pipelineRuns)
        .set({
          status: "failed",
          errorMessage:
            "GCP_SA_KEY not configured as a Pages secret. To enable web-launched runs, " +
            "run: wrangler pages secret put GCP_SA_KEY --project-name=seq2func",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(pipelineRuns.id, runId))
        .run();

      return NextResponse.json(
        { runId, status: "failed", error: "GCP_SA_KEY secret missing on Pages deployment." },
        { status: 503 }
      );
    }

    const token = await getGcpAccessToken(saKey);

    const nfProfile = profile || "gcp";
    const envOverrides: Record<string, string> = {
      SRR_ID: srrId,
      RUN_ID: runId,
      NF_PROFILE: nfProfile,
      API_URL: "https://seq2func.win/api",
    };
    if (nfProfile === "gcp" && foldseekDb && FOLDSEEK_DB_MAP[foldseekDb]) {
      envOverrides.FOLDSEEK_DB = `gs://seq2func-nextflow/databases/${FOLDSEEK_DB_MAP[foldseekDb]}`;
    }

    const result = await triggerCloudRunJob({
      project,
      region,
      jobName,
      token,
      env: envOverrides,
    });

    if (!result.ok) {
      await db
        .update(pipelineRuns)
        .set({
          status: "failed",
          errorMessage: `Cloud Run Job trigger failed (${result.status}): ${result.body.slice(0, 500)}`,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(pipelineRuns.id, runId))
        .run();

      return NextResponse.json(
        { runId, status: "failed", error: `Cloud Run trigger returned ${result.status}` },
        { status: 502 }
      );
    }

    await db
      .update(pipelineRuns)
      .set({ status: "running", updatedAt: new Date().toISOString() })
      .where(eq(pipelineRuns.id, runId))
      .run();

    return NextResponse.json({
      runId,
      status: "running",
      message: `Pipeline launched for ${srrId}`,
    });
  } catch (error) {
    console.error("Launch error:", error);
    return NextResponse.json({ error: "Failed to launch pipeline" }, { status: 500 });
  }
}
