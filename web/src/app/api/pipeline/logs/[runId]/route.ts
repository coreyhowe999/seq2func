import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pipelineLogs } from "@/lib/schema";
import { eq, and, gt, like, asc } from "drizzle-orm";
import { mockLogs } from "@/lib/mockData";

export const runtime = "edge";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const { searchParams } = new URL(request.url);
    const level = searchParams.get("level");
    const source = searchParams.get("source");
    const after = searchParams.get("after");
    const search = searchParams.get("search");
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam) : 500;

    if (process.env.USE_MOCK_DATA === "true") {
      let filtered = [...mockLogs];
      if (level === "errors") filtered = filtered.filter((l) => l.level === "error");
      else if (level === "warnings")
        filtered = filtered.filter((l) => l.level === "warn" || l.level === "error");
      else if (level && level !== "all") filtered = filtered.filter((l) => l.level === level);
      if (source) filtered = filtered.filter((l) => l.source === source);
      if (after) filtered = filtered.filter((l) => l.timestamp > after);
      if (search)
        filtered = filtered.filter((l) => l.message.toLowerCase().includes(search.toLowerCase()));
      return NextResponse.json({ logs: filtered.slice(0, limit), count: filtered.length, runId });
    }

    const db = getDb();
    const conditions = [eq(pipelineLogs.runId, runId)];

    if (level && level !== "all") {
      if (level === "errors") {
        conditions.push(eq(pipelineLogs.level, "error"));
      } else if (level === "warnings") {
        // Post-filter below for warn+error
      } else {
        conditions.push(eq(pipelineLogs.level, level));
      }
    }

    if (source) conditions.push(eq(pipelineLogs.source, source));
    if (after) conditions.push(gt(pipelineLogs.timestamp, after));
    if (search) conditions.push(like(pipelineLogs.message, `%${search}%`));

    let logs = await db
      .select()
      .from(pipelineLogs)
      .where(and(...conditions))
      .orderBy(asc(pipelineLogs.timestamp))
      .limit(limit)
      .all();

    if (level === "warnings") {
      logs = logs.filter((l) => l.level === "warn" || l.level === "error");
    }

    return NextResponse.json({ logs, count: logs.length, runId });
  } catch (error) {
    console.error("Logs fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
