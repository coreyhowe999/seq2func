#!/usr/bin/env python3
"""
generate_gwas_data.py — Generate Realistic Synthetic GWAS Summary Statistics

Produces two sets of GWAS summary statistics (exposure and outcome) that mimic
the Neale Lab UK Biobank format.  Causal, exposure-only, and pleiotropic signals
are planted so downstream MR analysis yields meaningful results.

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
# Signal planting helpers
# ---------------------------------------------------------------------------

def _generate_signal_indices(n_variants: int, n_signals: int, rng: np.random.Generator) -> np.ndarray:
    """Pick well-spaced positions for planted signals."""
    spacing = n_variants // (n_signals + 1)
    centres = np.arange(1, n_signals + 1) * spacing
    jitter = rng.integers(-spacing // 4, spacing // 4, size=n_signals)
    indices = np.clip(centres + jitter, 0, n_variants - 1)
    return np.unique(indices)


def _add_local_ld(stats: np.ndarray, positions: np.ndarray, signal_idx: int,
                  window_bp: int, rng: np.random.Generator, decay: float = 500_000) -> None:
    """Add simulated LD by correlating z-scores of nearby variants."""
    pos_signal = positions[signal_idx]
    z_signal = stats[signal_idx]
    mask = np.abs(positions - pos_signal) < window_bp
    mask[signal_idx] = False
    distances = np.abs(positions[mask].astype(float) - pos_signal)
    r = np.exp(-distances / decay) * rng.uniform(0.3, 0.8, size=distances.shape)
    stats[mask] += z_signal * r


# ---------------------------------------------------------------------------
# Main generation function
# ---------------------------------------------------------------------------

def generate_gwas(
    chrom: int,
    n_variants: int,
    n_samples_exposure: int,
    n_samples_outcome: int,
    seed: int | None = None,
) -> tuple[pl.DataFrame, pl.DataFrame, dict]:
    """Return (exposure_df, outcome_df, summary_info)."""

    rng = np.random.default_rng(seed)
    n_per_chr = n_variants  # variants for this chromosome

    # ----- variant metadata ------------------------------------------------
    rsids = np.array([f"rs{chrom}{i:07d}" for i in range(n_per_chr)])
    positions = np.sort(rng.integers(1, 250_000_000, size=n_per_chr))

    alleles = np.array(["A", "C", "G", "T"])
    a1 = rng.choice(alleles, size=n_per_chr)
    a2_choices = {"A": ["C", "G", "T"], "C": ["A", "G", "T"],
                  "G": ["A", "C", "T"], "T": ["A", "C", "G"]}
    a2 = np.array([rng.choice(a2_choices[a]) for a in a1])

    # Allele frequency — Beta distribution gives realistic right-skewed MAF
    freq = rng.beta(2, 5, size=n_per_chr).clip(0.01, 0.99)

    # INFO score — realistic distribution skewed toward 1.0
    info = rng.beta(8, 2, size=n_per_chr).clip(0.3, 1.0)

    # ----- null z-scores ---------------------------------------------------
    z_exposure = rng.standard_normal(n_per_chr)
    z_outcome = rng.standard_normal(n_per_chr)

    # ----- plant signals ---------------------------------------------------
    n_signals = rng.integers(8, 16)
    signal_indices = _generate_signal_indices(n_per_chr, n_signals, rng)
    n_signals = len(signal_indices)  # may shrink after np.unique

    # Decide signal types
    n_causal = max(2, n_signals // 3)       # shared between exposure & outcome
    n_exposure_only = max(2, n_signals // 3) # instruments, not causal for outcome
    n_pleiotropic = n_signals - n_causal - n_exposure_only  # outcome-only

    idx_causal = signal_indices[:n_causal]
    idx_exposure = signal_indices[n_causal:n_causal + n_exposure_only]
    idx_pleio = signal_indices[n_causal + n_exposure_only:]

    # True causal effect size (exposure -> outcome)
    true_causal_effect = 0.15

    # Causal signals: strong in exposure, proportional in outcome
    for idx in idx_causal:
        z_exp = rng.uniform(5.0, 8.0) * rng.choice([-1, 1])
        z_exposure[idx] = z_exp
        # outcome z ≈ causal_effect * exposure_z + noise
        z_outcome[idx] = true_causal_effect * z_exp + rng.normal(0, 0.5)

    # Exposure-only signals
    for idx in idx_exposure:
        z_exposure[idx] = rng.uniform(5.0, 9.0) * rng.choice([-1, 1])
        # outcome stays null (already drawn from N(0,1))

    # Pleiotropic signals (outcome-only, weaker)
    for idx in idx_pleio:
        z_outcome[idx] = rng.uniform(4.0, 6.0) * rng.choice([-1, 1])

    # ----- add local LD structure ------------------------------------------
    all_signal_idx = np.concatenate([idx_causal, idx_exposure, idx_pleio])
    for si in all_signal_idx:
        _add_local_ld(z_exposure, positions, si, 500_000, rng)
        _add_local_ld(z_outcome, positions, si, 500_000, rng)

    # ----- compute BETA / SE / P -------------------------------------------
    se_exposure = 1.0 / np.sqrt(n_samples_exposure * 2 * freq * (1 - freq))
    se_outcome  = 1.0 / np.sqrt(n_samples_outcome * 2 * freq * (1 - freq))

    beta_exposure = z_exposure * se_exposure
    beta_outcome  = z_outcome * se_outcome

    # P-values from z-scores (two-sided)
    from scipy.stats import norm
    p_exposure = 2 * norm.sf(np.abs(z_exposure))
    p_outcome  = 2 * norm.sf(np.abs(z_outcome))

    # ----- assemble data frames --------------------------------------------
    common = {
        "SNP": rsids, "CHR": np.full(n_per_chr, chrom, dtype=np.int32),
        "BP": positions, "A1": a1, "A2": a2, "FREQ": freq,
    }

    exposure_df = pl.DataFrame({
        **common,
        "BETA": beta_exposure, "SE": se_exposure, "P": p_exposure,
        "N": np.full(n_per_chr, n_samples_exposure, dtype=np.int32),
        "INFO": info,
    })

    outcome_df = pl.DataFrame({
        **common,
        "BETA": beta_outcome, "SE": se_outcome, "P": p_outcome,
        "N": np.full(n_per_chr, n_samples_outcome, dtype=np.int32),
        "INFO": info,
    })

    # ----- summary ---------------------------------------------------------
    lambda_gc_exp = float(np.median(z_exposure ** 2) / 0.4549)
    lambda_gc_out = float(np.median(z_outcome ** 2) / 0.4549)
    sig_exp = int(np.sum(p_exposure < 5e-8))
    sig_out = int(np.sum(p_outcome < 5e-8))

    summary = {
        "chromosome": chrom,
        "n_variants": n_per_chr,
        "exposure_significant_hits": sig_exp,
        "outcome_significant_hits": sig_out,
        "exposure_lambda_gc": round(lambda_gc_exp, 4),
        "outcome_lambda_gc": round(lambda_gc_out, 4),
        "n_causal_signals": int(n_causal),
        "n_exposure_only_signals": int(n_exposure_only),
        "n_pleiotropic_signals": int(len(idx_pleio)),
        "true_causal_effect": true_causal_effect,
    }

    return exposure_df, outcome_df, summary


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def write_gzipped_tsv(df: pl.DataFrame, path: Path) -> None:
    """Write a Polars DataFrame to a gzipped TSV."""
    tsv_bytes = df.write_csv(separator="\t").encode("utf-8")
    with gzip.open(path, "wb") as fh:
        fh.write(tsv_bytes)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic GWAS summary statistics")
    parser.add_argument("--chrom", type=int, required=True, help="Chromosome number")
    parser.add_argument("--n-variants", type=int, default=500_000, help="Number of variants")
    parser.add_argument("--n-samples-exposure", type=int, default=50_000)
    parser.add_argument("--n-samples-outcome", type=int, default=50_000)
    parser.add_argument("--seed", type=int, default=None, help="Random seed (default: chrom-based)")
    parser.add_argument("--outdir", type=str, default=".")
    args = parser.parse_args()

    seed = args.seed if args.seed is not None else 42 + args.chrom
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    exposure_df, outcome_df, summary = generate_gwas(
        chrom=args.chrom,
        n_variants=args.n_variants,
        n_samples_exposure=args.n_samples_exposure,
        n_samples_outcome=args.n_samples_outcome,
        seed=seed,
    )

    exp_path = outdir / f"exposure_chr{args.chrom}.tsv.gz"
    out_path = outdir / f"outcome_chr{args.chrom}.tsv.gz"
    write_gzipped_tsv(exposure_df, exp_path)
    write_gzipped_tsv(outcome_df, out_path)

    # Print summary to stdout (Nextflow will capture this in the log)
    print(json.dumps(summary, indent=2))
    print(f"\nChromosome {args.chrom}: {summary['n_variants']} variants generated", file=sys.stderr)
    print(f"  Exposure hits (P<5e-8): {summary['exposure_significant_hits']}", file=sys.stderr)
    print(f"  Outcome hits  (P<5e-8): {summary['outcome_significant_hits']}", file=sys.stderr)
    print(f"  Lambda GC (exposure): {summary['exposure_lambda_gc']}", file=sys.stderr)
    print(f"  Lambda GC (outcome):  {summary['outcome_lambda_gc']}", file=sys.stderr)


if __name__ == "__main__":
    main()
