#!/usr/bin/env python3
"""
ld_clumping.py — LD Clumping (Distance-Based Greedy Algorithm)

Without a real LD reference panel we simulate clumping by greedily selecting
the most significant SNP and removing all nearby variants within a distance
window on the same chromosome.  This mirrors PLINK's --clump behaviour.

Author: Corey — 5 Prime Sciences interview project
"""

import argparse
import gzip
import json
import sys
from pathlib import Path

import polars as pl


def ld_clump(
    df: pl.DataFrame,
    p_threshold: float = 5e-8,
    r2_window_kb: int = 10_000,
) -> pl.DataFrame:
    """
    Greedy distance-based LD clumping.

    1. Keep only variants with P < p_threshold.
    2. Sort by P ascending.
    3. Pick the top SNP as an index SNP.
    4. Remove all SNPs within r2_window_kb on the same chromosome.
    5. Repeat until no candidates remain.

    Returns a DataFrame of independent lead SNPs.
    """
    window_bp = r2_window_kb * 1_000  # convert kb -> bp

    # Pre-filter to genome-wide significant
    candidates = (
        df.filter(pl.col("P") < p_threshold)
        .sort("P")
        .to_dicts()
    )

    lead_snps: list[dict] = []

    while candidates:
        # Pick the top (most significant) remaining SNP
        top = candidates.pop(0)
        lead_snps.append(top)

        # Remove all candidates on the same chromosome within the window
        top_chr = top["CHR"]
        top_bp = top["BP"]

        candidates = [
            c for c in candidates
            if not (c["CHR"] == top_chr and abs(c["BP"] - top_bp) < window_bp)
        ]

    if not lead_snps:
        return pl.DataFrame(schema=df.schema)

    return pl.DataFrame(lead_snps).select(df.columns)


def main() -> None:
    parser = argparse.ArgumentParser(description="LD clumping of GWAS summary statistics")
    parser.add_argument("--input", type=Path, nargs="+", required=True,
                        help="Input QC'd GWAS TSV files (optionally gzipped)")
    parser.add_argument("--output", type=Path, required=True, help="Output lead SNPs TSV")
    parser.add_argument("--p-threshold", type=float, default=5e-8)
    parser.add_argument("--clumping-window", type=int, default=10_000,
                        help="Clumping window in kb")
    parser.add_argument("--metrics", type=Path, default=None, help="Output metrics JSON")
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)

    # Read and concatenate all input files (genome-wide)
    frames: list[pl.DataFrame] = []
    for p in args.input:
        frames.append(pl.read_csv(p, separator="\t"))
    df = pl.concat(frames)

    print(f"Genome-wide input: {len(df)} variants across {df['CHR'].n_unique()} chromosomes",
          file=sys.stderr)

    lead_df = ld_clump(df, p_threshold=args.p_threshold, r2_window_kb=args.clumping_window)

    # Write lead SNPs
    lead_df.write_csv(args.output, separator="\t")

    # Per-chromosome summary
    if len(lead_df) > 0:
        per_chr = (
            lead_df
            .group_by("CHR")
            .agg(pl.len().alias("n_loci"))
            .sort("CHR")
        )
        print(f"\nIndependent loci found: {len(lead_df)}", file=sys.stderr)
        for row in per_chr.iter_rows(named=True):
            print(f"  Chr {row['CHR']}: {row['n_loci']} loci", file=sys.stderr)
    else:
        print("WARNING: No genome-wide significant loci found after clumping", file=sys.stderr)

    # Write metrics
    if args.metrics:
        args.metrics.parent.mkdir(parents=True, exist_ok=True)
        metrics = {
            "total_lead_snps": len(lead_df),
            "p_threshold": args.p_threshold,
            "clumping_window_kb": args.clumping_window,
        }
        if len(lead_df) > 0:
            metrics["per_chromosome"] = (
                lead_df.group_by("CHR")
                .agg(pl.len().alias("n_loci"))
                .sort("CHR")
                .to_dicts()
            )
        with open(args.metrics, "w") as fh:
            json.dump(metrics, fh, indent=2)


if __name__ == "__main__":
    main()
