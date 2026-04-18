#!/usr/bin/env python3
"""
run_mr.py — Two-Sample Mendelian Randomization

Implements four MR methods from scratch:
  1. Wald ratio (single instrument)
  2. Inverse Variance Weighted (IVW) — fixed-effects meta-analysis
  3. MR-Egger — weighted regression testing for pleiotropy
  4. Weighted Median — robust to up to 50 % invalid instruments

Also computes heterogeneity (Cochran's Q, I-squared), instrument strength
(F-statistic), and the MR-Egger intercept test for directional pleiotropy.

Author: Corey — 5 Prime Sciences interview project
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import polars as pl
from scipy import stats


# ---------------------------------------------------------------------------
# Harmonisation
# ---------------------------------------------------------------------------

COMPLEMENT = {"A": "T", "T": "A", "C": "G", "G": "C"}


def harmonise(exposure: pl.DataFrame, outcome: pl.DataFrame) -> pl.DataFrame:
    """
    Align exposure and outcome alleles.

    - Match on SNP id
    - Flip outcome BETA sign when effect alleles are swapped
    - Remove palindromic SNPs with ambiguous strand (A/T, C/G)
    """
    merged = exposure.join(outcome, on="SNP", suffix="_out")

    # Remove palindromic SNPs
    merged = merged.filter(
        ~(
            ((pl.col("A1") == "A") & (pl.col("A2") == "T"))
            | ((pl.col("A1") == "T") & (pl.col("A2") == "A"))
            | ((pl.col("A1") == "C") & (pl.col("A2") == "G"))
            | ((pl.col("A1") == "G") & (pl.col("A2") == "C"))
        )
    )

    # If alleles are swapped, flip outcome beta
    merged = merged.with_columns(
        pl.when(pl.col("A1") == pl.col("A1_out"))
        .then(pl.col("BETA_out"))
        .otherwise(-pl.col("BETA_out"))
        .alias("BETA_out")
    )

    return merged


# ---------------------------------------------------------------------------
# MR methods
# ---------------------------------------------------------------------------

def wald_ratio(beta_exp: float, beta_out: float, se_out: float, se_exp: float) -> dict:
    """Single-instrument Wald ratio."""
    estimate = beta_out / beta_exp
    se = np.sqrt(se_out ** 2 / beta_exp ** 2 + beta_out ** 2 * se_exp ** 2 / beta_exp ** 4)
    z = estimate / se
    p = 2 * stats.norm.sf(abs(z))
    ci_lo = estimate - 1.96 * se
    ci_hi = estimate + 1.96 * se
    return {"method": "wald_ratio", "estimate": estimate, "se": se,
            "pvalue": p, "ci_lower": ci_lo, "ci_upper": ci_hi, "n_instruments": 1}


def ivw(beta_exp: np.ndarray, beta_out: np.ndarray,
        se_exp: np.ndarray, se_out: np.ndarray) -> dict:
    """
    Inverse Variance Weighted (fixed-effects).

    causal_estimate = sum(w * beta_hat) / sum(w)
    where beta_hat_i = beta_out_i / beta_exp_i
    and   w_i = beta_exp_i^2 / se_out_i^2   (second-order weights)
    """
    beta_hat = beta_out / beta_exp
    w = beta_exp ** 2 / se_out ** 2

    estimate = np.sum(w * beta_hat) / np.sum(w)
    se = np.sqrt(1.0 / np.sum(w))
    z = estimate / se
    p = 2 * stats.norm.sf(abs(z))
    ci_lo = estimate - 1.96 * se
    ci_hi = estimate + 1.96 * se

    return {"method": "ivw", "estimate": float(estimate), "se": float(se),
            "pvalue": float(p), "ci_lower": float(ci_lo), "ci_upper": float(ci_hi),
            "n_instruments": len(beta_exp)}


def mr_egger(beta_exp: np.ndarray, beta_out: np.ndarray,
             se_exp: np.ndarray, se_out: np.ndarray) -> dict:
    """
    MR-Egger regression.

    Weighted linear regression: beta_out = intercept + slope * beta_exp
    Weights: 1 / se_out^2
    The intercept tests for directional pleiotropy.
    """
    w = 1.0 / se_out ** 2

    # Ensure all beta_exp point in the same direction (Egger orientation)
    sign = np.sign(beta_exp)
    beta_exp_oriented = np.abs(beta_exp)
    beta_out_oriented = beta_out * sign

    # Weighted least squares
    W = np.diag(w)
    X = np.column_stack([np.ones_like(beta_exp_oriented), beta_exp_oriented])
    XtWX = X.T @ W @ X
    XtWy = X.T @ W @ beta_out_oriented

    try:
        params = np.linalg.solve(XtWX, XtWy)
    except np.linalg.LinAlgError:
        return {"method": "mr_egger", "estimate": float("nan"), "se": float("nan"),
                "pvalue": float("nan"), "ci_lower": float("nan"), "ci_upper": float("nan"),
                "n_instruments": len(beta_exp), "intercept": float("nan"),
                "intercept_se": float("nan"), "intercept_pvalue": float("nan")}

    intercept, slope = params

    # Residual variance
    residuals = beta_out_oriented - X @ params
    n = len(beta_exp)
    rss = float(residuals.T @ W @ residuals)
    sigma2 = rss / (n - 2) if n > 2 else float("nan")

    # Standard errors
    try:
        cov_matrix = sigma2 * np.linalg.inv(XtWX)
    except np.linalg.LinAlgError:
        cov_matrix = np.full((2, 2), float("nan"))

    se_intercept = np.sqrt(cov_matrix[0, 0])
    se_slope = np.sqrt(cov_matrix[1, 1])

    z_slope = slope / se_slope if se_slope > 0 else float("nan")
    p_slope = 2 * stats.norm.sf(abs(z_slope)) if not np.isnan(z_slope) else float("nan")

    z_intercept = intercept / se_intercept if se_intercept > 0 else float("nan")
    p_intercept = 2 * stats.norm.sf(abs(z_intercept)) if not np.isnan(z_intercept) else float("nan")

    return {
        "method": "mr_egger",
        "estimate": float(slope),
        "se": float(se_slope),
        "pvalue": float(p_slope),
        "ci_lower": float(slope - 1.96 * se_slope),
        "ci_upper": float(slope + 1.96 * se_slope),
        "n_instruments": n,
        "intercept": float(intercept),
        "intercept_se": float(se_intercept),
        "intercept_pvalue": float(p_intercept),
    }


def weighted_median(beta_exp: np.ndarray, beta_out: np.ndarray,
                    se_exp: np.ndarray, se_out: np.ndarray,
                    n_boot: int = 1000, seed: int = 42) -> dict:
    """
    Weighted median MR estimator.

    Take the weighted median of individual Wald ratios, weighted by
    inverse variance.  Bootstrap standard error.
    """
    rng = np.random.default_rng(seed)

    beta_hat = beta_out / beta_exp
    se_hat = se_out / np.abs(beta_exp)
    w = 1.0 / se_hat ** 2

    def _weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
        order = np.argsort(values)
        sorted_vals = values[order]
        sorted_w = weights[order]
        cum_w = np.cumsum(sorted_w)
        cum_w /= cum_w[-1]
        idx = np.searchsorted(cum_w, 0.5)
        return float(sorted_vals[min(idx, len(sorted_vals) - 1)])

    estimate = _weighted_median(beta_hat, w)

    # Bootstrap SE
    boot_estimates = np.empty(n_boot)
    for i in range(n_boot):
        b_exp = beta_exp + rng.normal(0, se_exp)
        b_out = beta_out + rng.normal(0, se_out)
        b_hat = b_out / b_exp
        b_se = se_out / np.abs(b_exp)
        b_w = 1.0 / b_se ** 2
        boot_estimates[i] = _weighted_median(b_hat, b_w)

    se = float(np.std(boot_estimates))
    z = estimate / se if se > 0 else float("nan")
    p = 2 * stats.norm.sf(abs(z)) if not np.isnan(z) else float("nan")

    return {
        "method": "weighted_median",
        "estimate": float(estimate),
        "se": se,
        "pvalue": float(p),
        "ci_lower": float(estimate - 1.96 * se),
        "ci_upper": float(estimate + 1.96 * se),
        "n_instruments": len(beta_exp),
    }


# ---------------------------------------------------------------------------
# Heterogeneity & instrument strength
# ---------------------------------------------------------------------------

def cochrans_q(beta_exp: np.ndarray, beta_out: np.ndarray,
               se_out: np.ndarray, ivw_estimate: float) -> dict:
    """Cochran's Q test for heterogeneity."""
    beta_hat = beta_out / beta_exp
    w = beta_exp ** 2 / se_out ** 2
    Q = float(np.sum(w * (beta_hat - ivw_estimate) ** 2))
    df = len(beta_exp) - 1
    p = float(stats.chi2.sf(Q, df)) if df > 0 else float("nan")
    I2 = max(0, (Q - df) / Q * 100) if Q > 0 else 0.0
    return {"Q": Q, "Q_df": df, "Q_pvalue": p, "I_squared": I2}


def f_statistic(beta_exp: np.ndarray, se_exp: np.ndarray) -> dict:
    """Mean F-statistic for instrument strength (should be > 10)."""
    f_per_snp = (beta_exp / se_exp) ** 2
    return {"mean_F": float(np.mean(f_per_snp)),
            "min_F": float(np.min(f_per_snp)),
            "n_weak_instruments": int(np.sum(f_per_snp < 10))}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Two-sample Mendelian Randomization")
    parser.add_argument("--exposure", type=Path, required=True, help="Exposure QC'd GWAS TSV(.gz)")
    parser.add_argument("--outcome", type=Path, required=True, help="Outcome QC'd GWAS TSV(.gz)")
    parser.add_argument("--instruments", type=Path, required=True, help="Lead SNPs from clumping (TSV)")
    parser.add_argument("--methods", nargs="+", default=["ivw", "egger", "weighted_median", "wald_ratio"])
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-instruments", type=Path, required=True,
                        help="Per-instrument statistics TSV for plotting")
    args = parser.parse_args()

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_instruments.parent.mkdir(parents=True, exist_ok=True)

    # Read data
    exposure = pl.read_csv(args.exposure, separator="\t")
    outcome = pl.read_csv(args.outcome, separator="\t")
    instruments = pl.read_csv(args.instruments, separator="\t")

    # Filter exposure and outcome to instrument SNPs only
    instrument_snps = instruments["SNP"].to_list()
    exposure_inst = exposure.filter(pl.col("SNP").is_in(instrument_snps))
    outcome_inst = outcome.filter(pl.col("SNP").is_in(instrument_snps))

    # Harmonise
    harmonised = harmonise(exposure_inst, outcome_inst)

    n_instruments = len(harmonised)
    print(f"Harmonised instruments: {n_instruments}", file=sys.stderr)

    if n_instruments == 0:
        print("ERROR: No instruments after harmonisation", file=sys.stderr)
        empty_result = {"error": "No instruments after harmonisation", "results": []}
        with open(args.output_json, "w") as fh:
            json.dump(empty_result, fh, indent=2)
        sys.exit(0)

    beta_exp = harmonised["BETA"].to_numpy()
    beta_out = harmonised["BETA_out"].to_numpy()
    se_exp = harmonised["SE"].to_numpy()
    se_out = harmonised["SE_out"].to_numpy()

    # Run MR methods
    results: list[dict] = []

    if "wald_ratio" in args.methods and n_instruments >= 1:
        # Report Wald ratio for the strongest instrument
        strongest = int(np.argmin(harmonised["P"].to_numpy()))
        wr = wald_ratio(float(beta_exp[strongest]), float(beta_out[strongest]),
                        float(se_out[strongest]), float(se_exp[strongest]))
        wr["strongest_snp"] = harmonised["SNP"][strongest]
        results.append(wr)

    if "ivw" in args.methods and n_instruments >= 2:
        results.append(ivw(beta_exp, beta_out, se_exp, se_out))

    if "egger" in args.methods and n_instruments >= 3:
        results.append(mr_egger(beta_exp, beta_out, se_exp, se_out))

    if "weighted_median" in args.methods and n_instruments >= 3:
        results.append(weighted_median(beta_exp, beta_out, se_exp, se_out))

    # Heterogeneity and instrument strength
    ivw_est = next((r["estimate"] for r in results if r["method"] == "ivw"), None)
    hetero = cochrans_q(beta_exp, beta_out, se_out, ivw_est) if ivw_est is not None else {}
    f_stats = f_statistic(beta_exp, se_exp)

    # Build output
    output = {
        "n_instruments": n_instruments,
        "results": results,
        "heterogeneity": hetero,
        "instrument_strength": f_stats,
    }

    # Per-instrument data for plotting
    instrument_df = pl.DataFrame({
        "SNP": harmonised["SNP"],
        "CHR": harmonised["CHR"],
        "BP": harmonised["BP"],
        "beta_exposure": beta_exp,
        "se_exposure": se_exp,
        "beta_outcome": beta_out,
        "se_outcome": se_out,
        "wald_ratio": beta_out / beta_exp,
        "wald_se": se_out / np.abs(beta_exp),
    })

    # Write outputs
    with open(args.output_json, "w") as fh:
        json.dump(output, fh, indent=2, default=float)

    instrument_df.write_csv(args.output_instruments, separator="\t")

    # Print summary
    print("\n=== MR Results ===", file=sys.stderr)
    for r in results:
        print(f"  {r['method']:20s}  beta={r['estimate']:.4f}  SE={r['se']:.4f}  "
              f"P={r['pvalue']:.2e}  95%CI=[{r['ci_lower']:.4f}, {r['ci_upper']:.4f}]  "
              f"n_inst={r['n_instruments']}", file=sys.stderr)
    if hetero:
        print(f"\n  Heterogeneity: Q={hetero['Q']:.2f}, I²={hetero['I_squared']:.1f}%, "
              f"P={hetero['Q_pvalue']:.2e}", file=sys.stderr)
    print(f"  Instrument strength: mean F={f_stats['mean_F']:.1f}, "
          f"weak (F<10): {f_stats['n_weak_instruments']}", file=sys.stderr)


if __name__ == "__main__":
    main()
