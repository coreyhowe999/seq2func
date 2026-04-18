import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proteins, cddDomains, cddSites, foldseekHits, prostt5Predictions, pipelineRuns, pipelineSteps } from "@/lib/schema";
import { eq, like, or, desc, asc } from "drizzle-orm";
import { mockProteins, mockRun, mockSteps } from "@/lib/mockData";
import type { ProteinAnnotation } from "@/lib/types";

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  try {
    const { runId } = params;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "50");
    const search = searchParams.get("search") || "";
    const sortField = searchParams.get("sort") || "length";
    const sortOrder = searchParams.get("order") || "desc";

    // Use mock data if configured
    if (process.env.USE_MOCK_DATA === "true") {
      let filtered = [...mockProteins];

      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter((p) =>
          p.protein_id.toLowerCase().includes(q) ||
          p.cdd.domains.some((d) => d.name.toLowerCase().includes(q)) ||
          p.foldseek.hits.some((h) => h.target_name.toLowerCase().includes(q))
        );
      }

      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const paginated = filtered.slice(start, start + pageSize);

      // Also return the run info and steps
      return NextResponse.json({
        run: { ...mockRun, steps: mockSteps },
        proteins: paginated,
        total,
        page,
        pageSize,
      });
    }

    // Fetch run info with steps
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get();
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const steps = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, runId)).all();

    // Fetch proteins for this run
    let proteinQuery = db.select().from(proteins).where(eq(proteins.runId, runId));

    const allProteins = proteinQuery.all();

    // Build full annotations
    const annotations: ProteinAnnotation[] = allProteins.map((protein) => {
      // Get CDD domains
      const domains = db.select()
        .from(cddDomains)
        .where(eq(cddDomains.proteinId, protein.id))
        .all()
        .map((d) => ({
          accession: d.accession,
          name: d.name,
          description: d.description || "",
          superfamily: d.superfamily || "",
          evalue: d.evalue,
          bitscore: d.bitscore,
          from: d.startPos,
          to: d.endPos,
        }));

      // Get CDD sites
      const sites = db.select()
        .from(cddSites)
        .where(eq(cddSites.proteinId, protein.id))
        .all()
        .map((s) => ({
          type: s.siteType,
          residues: JSON.parse(s.residues),
          description: s.description || "",
        }));

      // Get FoldSeek hits
      const fsHits = db.select()
        .from(foldseekHits)
        .where(eq(foldseekHits.proteinId, protein.id))
        .all()
        .map((h) => ({
          target_id: h.targetId,
          target_name: h.targetName || "",
          identity: h.identity || 0,
          evalue: h.evalue || 0,
          alignment_length: h.alignmentLength || 0,
          taxonomy: h.taxonomy || "",
        }));

      // Get ProstT5 prediction
      const prostt5 = db.select()
        .from(prostt5Predictions)
        .where(eq(prostt5Predictions.proteinId, protein.id))
        .get();

      return {
        protein_id: protein.proteinId,
        sequence: protein.sequence,
        length: protein.length,
        orf_type: protein.orfType,
        transcript_id: protein.transcriptId,
        cdd: { domains, sites },
        prostt5: {
          sequence_3di: prostt5?.sequence3di || "",
          has_prediction: !!prostt5,
        },
        foldseek: { hits: fsHits },
      };
    });

    // Filter by search
    let filtered = annotations;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((p) =>
        p.protein_id.toLowerCase().includes(q) ||
        p.cdd.domains.some((d) => d.name.toLowerCase().includes(q)) ||
        p.foldseek.hits.some((h) => h.target_name.toLowerCase().includes(q))
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "length":
          cmp = a.length - b.length;
          break;
        case "protein_id":
          cmp = a.protein_id.localeCompare(b.protein_id);
          break;
        case "domains":
          cmp = a.cdd.domains.length - b.cdd.domains.length;
          break;
        default:
          cmp = a.length - b.length;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });

    // Paginate
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paginated = filtered.slice(start, start + pageSize);

    return NextResponse.json({
      run: {
        ...run,
        steps,
        stepCounts: {
          total: steps.length,
          completed: steps.filter((s) => s.status === "completed").length,
          running: steps.filter((s) => s.status === "running").length,
          pending: steps.filter((s) => s.status === "pending").length,
          failed: steps.filter((s) => s.status === "failed").length,
          skipped: steps.filter((s) => s.status === "skipped").length,
        },
      },
      proteins: paginated,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("Results fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch results" },
      { status: 500 }
    );
  }
}
