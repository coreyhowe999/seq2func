#!/usr/bin/env python3
"""
parse_rpsblast.py — Parse RPS-BLAST output into structured JSON

Reads RPS-BLAST tabular output (outfmt 6) and converts it into a structured
JSON file keyed by protein ID.  Each protein entry contains:
  - Domain hits: accession, name, description, superfamily, E-value, bit score,
    start/end coordinates
  - Functional sites: type, residues, description (when rpsbproc output is available)

The output JSON is consumed by merge_annotations.py and ultimately displayed
in the web application's protein detail panels.

Author: Corey Howe — 5 Prime Sciences interview project
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


def parse_rpsblast_output(input_path: Path) -> dict:
    """
    Parse RPS-BLAST tabular output (outfmt 6 with custom columns).

    Expected columns (space/tab-separated):
        qseqid, sseqid, pident, length, mismatch, gapopen,
        qstart, qend, sstart, send, evalue, bitscore, stitle

    Returns:
        Dict keyed by protein_id, each value is a dict with:
          - domains: list of domain hit dicts
          - sites: list of functional site dicts (empty for basic outfmt 6)
    """
    results: dict[str, dict] = defaultdict(lambda: {"domains": [], "sites": []})

    if not input_path.exists() or input_path.stat().st_size == 0:
        print("No RPS-BLAST results found (empty file)", file=sys.stderr)
        return dict(results)

    with open(input_path) as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            fields = line.split("\t")
            if len(fields) < 12:
                print(
                    f"  Skipping line {line_num}: expected 12+ fields, got {len(fields)}",
                    file=sys.stderr,
                )
                continue

            protein_id = fields[0]
            subject_id = fields[1]

            # Parse the subject title to extract domain name and description.
            # CDD subject IDs look like: "CDD:123456" or "cd00001"
            # Subject title (stitle) contains the full domain description.
            stitle = fields[12] if len(fields) > 12 else subject_id

            # Extract domain accession and name from subject ID.
            # Typical format: "gnl|CDD|123456" or just the accession
            accession = subject_id.split("|")[-1] if "|" in subject_id else subject_id

            # Parse domain name from stitle — format is usually "name, description"
            parts = stitle.split(",", 1)
            domain_name = parts[0].strip()
            description = parts[1].strip() if len(parts) > 1 else ""

            try:
                domain = {
                    "accession": accession,
                    "name": domain_name,
                    "description": description,
                    "superfamily": "",  # Not available from basic outfmt 6
                    "evalue": float(fields[10]),
                    "bitscore": float(fields[11]),
                    "from": int(fields[6]),
                    "to": int(fields[7]),
                }
                results[protein_id]["domains"].append(domain)
            except (ValueError, IndexError) as e:
                print(f"  Error parsing line {line_num}: {e}", file=sys.stderr)
                continue

    # Sort domains by start position within each protein
    for protein_id in results:
        results[protein_id]["domains"].sort(key=lambda d: d["from"])

    return dict(results)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse RPS-BLAST output into structured JSON"
    )
    parser.add_argument(
        "--input", type=Path, required=True, help="RPS-BLAST tabular output file"
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Output JSON file"
    )
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)

    print(f"Parsing RPS-BLAST results from: {args.input}", file=sys.stderr)
    results = parse_rpsblast_output(args.input)

    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)

    total_proteins = len(results)
    total_domains = sum(len(r["domains"]) for r in results.values())
    print(
        f"Parsed {total_domains} domain hits across {total_proteins} proteins",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
