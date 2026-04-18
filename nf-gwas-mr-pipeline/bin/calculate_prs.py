#!/usr/bin/env python3
"""
calculate_prs.py — Polygenic Risk Score Calculation

Simulates PRS calculation for a synthetic cohort:
  - Generates synthetic genotypes for 1000 individuals at lead SNPs
  - Computes PRS = sum(genotype_i * beta_i) at multiple p-value thresholds
  - Evaluates predictive performance (R-squared) at each threshold

Author: Corey — 5 Prime Sciences interview project
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import polars as pl


# ---------------------------------------------------------------------------
# PRS calculation
# ---------------------------------------------------------------------------

PRS_THRESHOLDS = [5e-8, 1e-5, 1e-3, 0.01, 0.05, 0.1, 0.5, 1.0]


def simulate_genotypes(
    n_individuals: int,
    allele_freqs: np.ndarray,
    rng: np.random.Generator,
) -> np.ndarray:
    """
    Simulate genotypes (0, 1, 2 copies of effect allele) for each individual
    at each SNP using a Binomial model based on allele frequency.

    Returns shape (n_individuals, n_snps).
    """
    n_snps = len(allele_freqs)
    genotypes = np.empty((n_individuals, n_snps), dtype=np.int8)
    for j in range(n_snps):
        genotypes[:, j] = rng.binomial(2, allele_freqs[j], size=n_individuals)
    return genotypes


def calculate_prs_at_threshold(
    genotypes: np.ndarray,
    betas: np.ndarray,
    p_values: np.ndarray,
    threshold: float,
) -> tuple[np.ndarray, int]:
    """
    Calculate PRS = sum(genotype_i * beta_i) for SNPs with P < threshold.

    Returns (prs_array, n_snps_included).
    """
    mask = p_values < threshold
    n_included = int(np.sum(mask))
    if n_included == 0:
        return np.zeros(genotypes.shape[0]), 0
    prs = genotypes[:, mask] @ betas[mask]
    return prs, n_included


def simulate_phenotype(
    genotypes: np.ndarray,
    betas: np.ndarray,
    heritability: float,
    rng: np.random.Generator,
) -> np.ndarray:
    """
    Simulate a continuous phenotype:
      phenotype = genetic_component + environmental_noise
    scaled so that Var(genetic) / Var(phenotype) ≈ heritability.
    """
    genetic = genotypes @ betas
    var_g = np.var(genetic)
    if var_g == 0:
        return rng.standard_normal(genotypes.shape[0])
    var_e = var_g * (1 - heritability) / heritability
    noise = rng.normal(0, np.sqrt(var_e), size=genotypes.shape[0])
    return genetic + noise


def r_squared(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Coefficient of determination from simple linear regression."""
    if np.std(y_pred) == 0 or np.std(y_true) == 0:
        return 0.0
    correlation = np.corrcoef(y_true, y_pred)[0, 1]
    return float(correlation ** 2)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Polygenic risk score calculation")
    parser.add_argument("--gwas", type=Path, required=True,
                        help="QC'd GWAS summary statistics (TSV, may be gzipped)")
    parser.add_argument("--instruments", type=Path, default=None,
                        help="Lead SNPs (used to identify which SNPs to include)")
    parser.add_argument("--n-individuals", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=123)
    parser.add_argument("--output-prs", type=Path, required=True, help="PRS per individual TSV")
    parser.add_argument("--output-metrics", type=Path, required=True, help="PRS metrics JSON")
    args = parser.parse_args()

    args.output_prs.parent.mkdir(parents=True, exist_ok=True)
    args.output_metrics.parent.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(args.seed)

    # Read GWAS summary stats
    df = pl.read_csv(args.gwas, separator="\t")

    snp_ids = df["SNP"].to_numpy()
    betas = df["BETA"].to_numpy()
    p_values = df["P"].to_numpy()
    freqs = df["FREQ"].to_numpy()

    print(f"Input: {len(df)} variants", file=sys.stderr)

    # Simulate genotypes for the cohort
    genotypes = simulate_genotypes(args.n_individuals, freqs, rng)

    # Simulate a phenotype using all truly associated SNPs (P < 0.05 proxy)
    phenotype = simulate_phenotype(genotypes, betas, heritability=0.3, rng=rng)

    # Simulate binary case/control from phenotype (top 30% are cases)
    case_threshold = np.percentile(phenotype, 70)
    case_status = (phenotype >= case_threshold).astype(int)

    # Calculate PRS at each threshold
    threshold_results: list[dict] = []
    prs_data: dict[str, np.ndarray] = {"individual_id": np.arange(args.n_individuals)}
    best_r2 = -1.0
    best_threshold = PRS_THRESHOLDS[0]

    for thresh in PRS_THRESHOLDS:
        prs, n_snps = calculate_prs_at_threshold(genotypes, betas, p_values, thresh)
        col_name = f"prs_p{thresh}"
        prs_data[col_name] = prs

        r2 = r_squared(phenotype, prs) if n_snps > 0 else 0.0

        result = {
            "p_threshold": thresh,
            "n_snps_included": n_snps,
            "prs_mean": float(np.mean(prs)),
            "prs_sd": float(np.std(prs)),
            "r_squared": round(r2, 6),
        }
        threshold_results.append(result)

        if r2 > best_r2:
            best_r2 = r2
            best_threshold = thresh

        print(f"  P<{thresh:.0e}: {n_snps} SNPs, R²={r2:.4f}", file=sys.stderr)

    # Build PRS output DataFrame
    prs_data["phenotype"] = phenotype
    prs_data["case_status"] = case_status
    prs_df = pl.DataFrame(prs_data)

    # Add the optimal PRS as a named column for easy downstream use
    optimal_col = f"prs_p{best_threshold}"
    prs_df = prs_df.with_columns(pl.col(optimal_col).alias("prs_optimal"))

    # Write outputs
    prs_df.write_csv(args.output_prs, separator="\t")

    metrics = {
        "n_individuals": args.n_individuals,
        "n_total_snps": len(df),
        "optimal_threshold": best_threshold,
        "optimal_r_squared": round(best_r2, 6),
        "thresholds": threshold_results,
    }
    with open(args.output_metrics, "w") as fh:
        json.dump(metrics, fh, indent=2)

    print(f"\nOptimal threshold: P<{best_threshold:.0e} (R²={best_r2:.4f})", file=sys.stderr)


if __name__ == "__main__":
    main()
