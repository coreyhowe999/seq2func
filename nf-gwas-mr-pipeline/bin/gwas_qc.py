#!/usr/bin/env python3
"""
gwas_qc.py — GWAS Summary Statistics Quality Control

Applies standard QC filters to GWAS summary statistics using Polars lazy
evaluation to demonstrate out-of-core / streaming capabilities.

QC steps:
  1. MAF filter
  2. INFO score filter
  3. Palindromic / ambiguous SNP removal
  4. Extreme effect-size filter
  5. Sample-size filter
  6. Duplicate SNP removal

Author: Corey — 5 Prime Sciences interview project
"""

import argparse
import gzip
import json
import sys
from pathlib import Path

import numpy as np
import polars as pl


# ---------------------------------------------------------------------------
# QC functions — each takes a LazyFrame and returns a LazyFrame
# ---------------------------------------------------------------------------

PALINDROMIC_PAIRS = {("A", "T"), ("T", "A"), ("C", "G"), ("G", "C")}


def filter_maf(lf: pl.LazyFrame, threshold: float) -> pl.LazyFrame:
    """Remove variants with minor allele frequency below *threshold*."""
    return lf.filter(
        (pl.col("FREQ") >= threshold) & (pl.col("FREQ") <= (1.0 - threshold))
    )


def filter_info(lf: pl.LazyFrame, threshold: float) -> pl.LazyFrame:
    """Remove variants with imputation INFO score below *threshold*."""
    return lf.filter(pl.col("INFO") >= threshold)


def filter_palindromic(lf: pl.LazyFrame) -> pl.LazyFrame:
    """Remove ambiguous palindromic SNPs (A/T or C/G allele pairs)."""
    return lf.filter(
        ~(
            ((pl.col("A1") == "A") & (pl.col("A2") == "T"))
            | ((pl.col("A1") == "T") & (pl.col("A2") == "A"))
            | ((pl.col("A1") == "C") & (pl.col("A2") == "G"))
            | ((pl.col("A1") == "G") & (pl.col("A2") == "C"))
        )
    )


def filter_extreme_beta(lf: pl.LazyFrame, max_abs: float = 10.0) -> pl.LazyFrame:
    """Remove variants with extreme effect sizes."""
    return lf.filter(pl.col("BETA").abs() <= max_abs)


def filter_sample_size(lf: pl.LazyFrame, fraction: float = 0.5) -> pl.LazyFrame:
    """Remove variants with N < fraction * max(N)."""
    max_n = lf.select(pl.col("N").max()).collect().item()
    return lf.filter(pl.col("N") >= fraction * max_n)


def remove_duplicates(lf: pl.LazyFrame) -> pl.LazyFrame:
    """Remove duplicate SNPs, keeping the one with the lowest p-value."""
    return (
        lf.sort("P")
        .unique(subset=["SNP"], keep="first")
    )


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def compute_lambda_gc(p_values: np.ndarray) -> float:
    """Genomic inflation factor: median(chi2) / 0.4549."""
    from scipy.stats import chi2 as chi2_dist
    chi2_vals = chi2_dist.isf(p_values, df=1)
    return float(np.median(chi2_vals) / 0.4549)


# ---------------------------------------------------------------------------
# Main QC pipeline
# ---------------------------------------------------------------------------

def run_qc(
    input_path: Path,
    output_path: Path,
    metrics_path: Path,
    maf_threshold: float = 0.01,
    info_threshold: float = 0.8,
) -> dict:
    """Run the full QC pipeline and return metrics."""

    # Use scan_csv for lazy evaluation (streaming-friendly)
    lf = pl.scan_csv(input_path, separator="\t")
    n_start = lf.select(pl.len()).collect().item()

    metrics: dict = {"input_variants": n_start, "filters": {}}

    # Step 1: MAF filter
    lf = filter_maf(lf, maf_threshold)
    n_after = lf.select(pl.len()).collect().item()
    metrics["filters"]["maf_removed"] = n_start - n_after
    n_prev = n_after

    # Step 2: INFO filter
    lf = filter_info(lf, info_threshold)
    n_after = lf.select(pl.len()).collect().item()
    metrics["filters"]["info_removed"] = n_prev - n_after
    n_prev = n_after

    # Step 3: Palindromic SNP filter
    lf = filter_palindromic(lf)
    n_after = lf.select(pl.len()).collect().item()
    metrics["filters"]["palindromic_removed"] = n_prev - n_after
    n_prev = n_after

    # Step 4: Extreme beta filter
    lf = filter_extreme_beta(lf)
    n_after = lf.select(pl.len()).collect().item()
    metrics["filters"]["extreme_beta_removed"] = n_prev - n_after
    n_prev = n_after

    # Step 5: Sample-size filter
    lf = filter_sample_size(lf)
    n_after = lf.select(pl.len()).collect().item()
    metrics["filters"]["low_n_removed"] = n_prev - n_after
    n_prev = n_after

    # Step 6: Duplicate removal
    lf = remove_duplicates(lf)
    n_after = lf.select(pl.len()).collect().item()
    metrics["filters"]["duplicates_removed"] = n_prev - n_after

    # Collect final DataFrame
    df_qc = lf.collect()
    metrics["output_variants"] = len(df_qc)
    metrics["total_removed"] = n_start - len(df_qc)

    # Genome-wide significant hits
    n_sig = df_qc.filter(pl.col("P") < 5e-8).height
    metrics["significant_hits_5e8"] = n_sig

    # Genomic inflation factor
    p_vals = df_qc["P"].to_numpy()
    p_vals = p_vals[p_vals > 0]  # avoid log(0)
    metrics["lambda_gc"] = round(compute_lambda_gc(p_vals), 4)

    # Write outputs
    tsv_bytes = df_qc.write_csv(separator="\t").encode("utf-8")
    with gzip.open(output_path, "wb") as fh:
        fh.write(tsv_bytes)

    with open(metrics_path, "w") as fh:
        json.dump(metrics, fh, indent=2)

    return metrics


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="GWAS summary statistics QC")
    parser.add_argument("--input", type=Path, required=True, help="Input GWAS TSV (optionally gzipped)")
    parser.add_argument("--output", type=Path, required=True, help="Output QC'd TSV.gz")
    parser.add_argument("--metrics", type=Path, required=True, help="Output QC metrics JSON")
    parser.add_argument("--maf-threshold", type=float, default=0.01)
    parser.add_argument("--info-threshold", type=float, default=0.8)
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.metrics.parent.mkdir(parents=True, exist_ok=True)

    metrics = run_qc(
        input_path=args.input,
        output_path=args.output,
        metrics_path=args.metrics,
        maf_threshold=args.maf_threshold,
        info_threshold=args.info_threshold,
    )

    # Print summary to stderr (Nextflow log)
    print(f"QC complete: {metrics['input_variants']} -> {metrics['output_variants']} variants", file=sys.stderr)
    for filt, count in metrics["filters"].items():
        print(f"  {filt}: {count}", file=sys.stderr)
    print(f"  Lambda GC: {metrics['lambda_gc']}", file=sys.stderr)
    print(f"  Significant hits (P<5e-8): {metrics['significant_hits_5e8']}", file=sys.stderr)


if __name__ == "__main__":
    main()
