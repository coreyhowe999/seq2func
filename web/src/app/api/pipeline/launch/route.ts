import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pipelineRuns, pipelineSteps, pipelineLogs } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { PIPELINE_STEPS } from "@/lib/types";
import { uploadToR2 } from "@/lib/r2";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const SRR_REGEX = /^[SDE]RR\d{6,}$/;

// Classify a Nextflow log line into a level
function classifyLogLevel(line: string): "info" | "warn" | "error" | "debug" {
  const lower = line.toLowerCase();
  if (lower.includes("error") || lower.includes("failed") || lower.includes("exception")) return "error";
  if (lower.includes("warn")) return "warn";
  if (lower.includes("debug") || lower.includes("trace")) return "debug";
  return "info";
}

// Extract the step name from a Nextflow log line if it mentions one
function extractSource(line: string): string {
  const match = line.match(/process\s*[>`]\s*(\w+)/i);
  if (match) return `step:${match[1]}`;
  return "nextflow";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { srrId, sampleName, runId, profile: selectedProfile } = body;
    const nfProfile = selectedProfile || "standard";

    if (!srrId || !SRR_REGEX.test(srrId)) {
      return NextResponse.json(
        { error: "Invalid SRA accession ID. Must match format: SRR/ERR/DRR followed by 6+ digits." },
        { status: 400 }
      );
    }

    if (!runId) {
      return NextResponse.json(
        { error: "runId is required" },
        { status: 400 }
      );
    }

    // Create the pipeline run record
    db.insert(pipelineRuns).values({
      id: runId,
      srrId: srrId,
      sampleName: sampleName || srrId,
      status: "pending",
    }).run();

    // Create pipeline step records (all pending)
    for (const stepName of PIPELINE_STEPS) {
      db.insert(pipelineSteps).values({
        runId: runId,
        stepName: stepName,
        status: "pending",
      }).run();
    }

    // Update run status to 'running'
    db.update(pipelineRuns)
      .set({ status: "running", updatedAt: new Date().toISOString() })
      .where(eq(pipelineRuns.id, runId))
      .run();

    // Set up log file
    const logDir = path.join(process.cwd(), "data", "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFilePath = path.join(logDir, `${runId}.log`);
    const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

    // Log buffer for batched DB inserts
    let logBuffer: { timestamp: string; level: string; source: string; message: string }[] = [];
    let flushTimer: NodeJS.Timeout | null = null;

    const flushLogBuffer = () => {
      if (logBuffer.length === 0) return;
      const batch = logBuffer.splice(0, logBuffer.length);
      try {
        for (const entry of batch) {
          db.insert(pipelineLogs).values({
            runId: runId,
            timestamp: entry.timestamp,
            level: entry.level,
            source: entry.source,
            message: entry.message,
          }).run();
        }
      } catch (err) {
        console.error(`[Log flush error for ${runId}]:`, err);
      }
    };

    const appendLog = (line: string, stream: "stdout" | "stderr") => {
      const timestamp = new Date().toISOString();
      const level = stream === "stderr" ? classifyLogLevel(line) : "info";
      const source = extractSource(line);

      // Write to log file
      logStream.write(`[${timestamp}] [${level.toUpperCase()}] ${line}\n`);

      // Buffer for DB insert
      logBuffer.push({ timestamp, level, source, message: line });

      // Flush every 50 lines or set a timer
      if (logBuffer.length >= 50) {
        flushLogBuffer();
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushLogBuffer();
          flushTimer = null;
        }, 3000);
      }
    };

    // Spawn Nextflow process
    const pipelineDir = process.env.PIPELINE_DIR || path.join(process.cwd(), "..", "nf-transcriptome");
    const apiUrl = `http://localhost:${process.env.PORT || 3000}/api`;

    // Build Nextflow arguments based on selected profile
    const nfArgs = [
      "run", "main.nf",
      "--srr_id", srrId,
      "--run_id", runId,
      "--api_url", apiUrl,
      "-profile", nfProfile,
    ];

    // Add GCP-specific parameters if running on GCP
    if (nfProfile === "gcp") {
      if (process.env.GCP_PROJECT_ID) nfArgs.push("--gcp_project", process.env.GCP_PROJECT_ID);
      if (process.env.GCP_BUCKET) nfArgs.push("--gcp_bucket", process.env.GCP_BUCKET);
      if (process.env.GCP_REGION) nfArgs.push("--gcp_region", process.env.GCP_REGION);
    }

    const nfProcess = spawn("nextflow", nfArgs, {
      cwd: pipelineDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Ensure GCP credentials are passed through
        ...(nfProfile === "gcp" && process.env.GOOGLE_APPLICATION_CREDENTIALS
          ? { GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS }
          : {}),
      },
    });

    // Capture stdout
    nfProcess.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter((l) => l.trim());
      for (const line of lines) {
        appendLog(line, "stdout");
      }
    });

    // Capture stderr
    nfProcess.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter((l) => l.trim());
      for (const line of lines) {
        appendLog(line, "stderr");
      }
    });

    nfProcess.on("error", (err) => {
      appendLog(`Failed to start Nextflow: ${err.message}`, "stderr");
      flushLogBuffer();
      logStream.end();

      db.update(pipelineRuns)
        .set({
          status: "failed",
          errorMessage: `Failed to start Nextflow: ${err.message}`,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(pipelineRuns.id, runId))
        .run();
    });

    nfProcess.on("exit", async (code) => {
      appendLog(`Pipeline exited with code ${code}`, code === 0 ? "stdout" : "stderr");

      // Final flush
      if (flushTimer) clearTimeout(flushTimer);
      flushLogBuffer();
      logStream.end();

      if (code !== 0) {
        db.update(pipelineRuns)
          .set({
            status: "failed",
            errorMessage: `Nextflow exited with code ${code}`,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(pipelineRuns.id, runId))
          .run();
      }

      // Upload log file to R2
      try {
        const logContent = fs.readFileSync(logFilePath, "utf-8");
        const r2Key = `logs/${runId}.log`;
        await uploadToR2(r2Key, logContent, "text/plain");
        db.update(pipelineRuns)
          .set({ logR2Key: r2Key })
          .where(eq(pipelineRuns.id, runId))
          .run();
      } catch {
        // R2 upload is best-effort
      }
    });

    // Detach the process so it continues running after the API response
    nfProcess.unref();

    return NextResponse.json({
      runId,
      status: "running",
      message: `Pipeline launched for ${srrId}`,
    });
  } catch (error) {
    console.error("Launch error:", error);
    return NextResponse.json(
      { error: "Failed to launch pipeline" },
      { status: 500 }
    );
  }
}
