import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SRR_REGEX = /^[SDE]RR\d{6,}$/;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const srrId = searchParams.get("id");

  if (!srrId) {
    return NextResponse.json(
      { valid: false, error: "No SRA accession ID provided" },
      { status: 400 }
    );
  }

  // Basic format validation
  if (!SRR_REGEX.test(srrId)) {
    return NextResponse.json({
      valid: false,
      error: "Invalid format. Must be SRR/ERR/DRR followed by 6+ digits (e.g., SRR5437876)",
    });
  }

  // Optionally validate against NCBI (check if the accession exists)
  try {
    const response = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=sra&term=${srrId}&retmode=json`,
      { next: { revalidate: 3600 } } // Cache for 1 hour
    );

    if (response.ok) {
      const data = (await response.json()) as { esearchresult?: { count?: string } };
      const count = parseInt(data?.esearchresult?.count || "0");

      if (count > 0) {
        return NextResponse.json({
          valid: true,
          srrId,
          message: "Valid SRA accession found in NCBI",
        });
      } else {
        return NextResponse.json({
          valid: false,
          error: `Accession ${srrId} not found in NCBI SRA database`,
        });
      }
    }
  } catch {
    // If NCBI is unreachable, just validate format
    return NextResponse.json({
      valid: true,
      srrId,
      message: "Format is valid (NCBI validation skipped)",
    });
  }

  return NextResponse.json({ valid: true, srrId });
}
