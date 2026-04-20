import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pipelineRuns, pipelineSteps } from "@/lib/schema";
import { desc, eq } from "drizzle-orm";
import { mockRun, mockSteps } from "@/lib/mockData";

export const runtime = "edge";

export async function GET() {
  try {
    if (process.env.USE_MOCK_DATA === "true") {
      const stepCounts = {
        total: mockSteps.length,
        completed: mockSteps.filter((s) => s.status === "completed").length,
        running: mockSteps.filter((s) => s.status === "running").length,
        pending: mockSteps.filter((s) => s.status === "pending").length,
        failed: mockSteps.filter((s) => s.status === "failed").length,
        skipped: mockSteps.filter((s) => s.status === "skipped").length,
      };
      return NextResponse.json([{ ...mockRun, steps: mockSteps, stepCounts }]);
    }

    const db = getDb();
    const runs = await db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).all();

    const runsWithSteps = await Promise.all(
      runs.map(async (run) => {
        const steps = await db
          .select()
          .from(pipelineSteps)
          .where(eq(pipelineSteps.runId, run.id))
          .all();

        const stepCounts = {
          total: steps.length,
          completed: steps.filter((s) => s.status === "completed").length,
          running: steps.filter((s) => s.status === "running").length,
          pending: steps.filter((s) => s.status === "pending").length,
          failed: steps.filter((s) => s.status === "failed").length,
          skipped: steps.filter((s) => s.status === "skipped").length,
        };

        return { ...run, steps, stepCounts };
      })
    );

    return NextResponse.json(runsWithSteps);
  } catch (error) {
    console.error("Runs fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 });
  }
}
