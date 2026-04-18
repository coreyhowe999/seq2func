#!/usr/bin/env python3
"""
parse_foldseek.py — Parse FoldSeek structural search results into JSON

Reads FoldSeek tabular output and converts it into a structured JSON file
keyed by protein ID.  For each protein, keeps the top 5 structural homologs
ranked by E-value.

Each hit includes:
  - Target ID (typically a PDB chain identifier like "4HHB_A")
  - Target name (from the target header)
  - Sequence identity (fraction, 0.0 to 1.0)
  - E-value (statistical significance)
  - Alignment length
  - Taxonomy (organism name if available)

Author: Corey Howe — 5 Prime Sciences interview project
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


def parse_foldseek_output(input_path: Path, top_n: int = 5) -> dict:
    """
    Parse FoldSeek tabular output.

    Expected columns (tab-separated):
        query, target, fident, alnlen, mismatch, gapopen,
        qstart, qend, tstart, tend, evalue, bits, taxid, taxname, theader

    Args:
        input_path: Path to FoldSeek TSV output
        top_n: Keep only the top N hits per protein (ranked by E-value)

    Returns:
        Dict keyed by protein_id, each value is a dict with:
          - hits: list of structural homolog dicts (up to top_n)
    """
    results: dict[str, list] = defaultdict(list)

    if not input_path.exists() or input_path.stat().st_size == 0:
        print("No FoldSeek results found (empty file)", file=sys.stderr)
        return {}

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

            try:
                hit = {
                    "target_id": fields[1],
                    "target_name": fields[14] if len(fields) > 14 else fields[1],
                    "identity": float(fields[2]),
                    "evalue": float(fields[10]),
                    "alignment_length": int(fields[3]),
                    "taxonomy": fields[13] if len(fields) > 13 else "",
                }
                results[protein_id].append(hit)
            except (ValueError, IndexError) as e:
                print(f"  Error parsing line {line_num}: {e}", file=sys.stderr)
                continue

    # Keep top N hits per protein, ranked by E-value (ascending)
    output = {}
    for protein_id, hits in results.items():
        hits.sort(key=lambda h: h["evalue"])
        output[protein_id] = {"hits": hits[:top_n]}

    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse FoldSeek structural search results into JSON"
    )
    parser.add_argument(
        "--input", type=Path, required=True, help="FoldSeek TSV output file"
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Output JSON file"
    )
    parser.add_argument(
        "--top_n", type=int, default=5, help="Keep top N hits per protein"
    )
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)

    print(f"Parsing FoldSeek results from: {args.input}", file=sys.stderr)
    results = parse_foldseek_output(args.input, top_n=args.top_n)

    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)

    total_proteins = len(results)
    total_hits = sum(len(r["hits"]) for r in results.values())
    print(
        f"Parsed {total_hits} structural homologs across {total_proteins} proteins",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
