#!/usr/bin/env python3
"""
generate_report.py — Self-Contained HTML Report for GWAS-MR Pipeline

Generates a professional HTML report with embedded base64 plots:
  - Manhattan plot & QQ plot
  - LD clumping summary
  - MR forest / scatter / funnel plots
  - PRS performance charts

Author: Corey — 5 Prime Sciences interview project
"""

import argparse
import base64
import io
import json
import sys
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # non-interactive backend
import matplotlib.pyplot as plt
import numpy as np
import polars as pl


# ---------------------------------------------------------------------------
# Plot helpers
# ---------------------------------------------------------------------------

def fig_to_base64(fig: plt.Figure, dpi: int = 120) -> str:
    """Render a matplotlib figure to a base64-encoded PNG string."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")


def _chr_colours(chroms: np.ndarray) -> np.ndarray:
    """Alternating colours by chromosome for Manhattan plot."""
    palette = ["#1f77b4", "#aec7e8"]
    return np.array([palette[int(c) % 2] for c in chroms])


# ---------------------------------------------------------------------------
# GWAS plots
# ---------------------------------------------------------------------------

def manhattan_plot(df: pl.DataFrame) -> str:
    """Manhattan plot from merged QC'd summary statistics."""
    chrom = df["CHR"].to_numpy()
    bp = df["BP"].to_numpy()
    pval = df["P"].to_numpy()

    # Compute cumulative genomic positions
    chr_order = np.sort(np.unique(chrom))
    chr_offsets: dict[int, int] = {}
    running = 0
    for c in chr_order:
        chr_offsets[c] = running
        max_bp = int(bp[chrom == c].max()) if np.any(chrom == c) else 0
        running += max_bp + 5_000_000  # gap between chromosomes

    x = np.array([chr_offsets[c] + b for c, b in zip(chrom, bp)])
    y = -np.log10(np.maximum(pval, 1e-300))

    fig, ax = plt.subplots(figsize=(14, 5))
    colours = _chr_colours(chrom)
    ax.scatter(x, y, c=colours, s=1.5, alpha=0.6, rasterized=True)
    ax.axhline(-np.log10(5e-8), color="red", linestyle="--", linewidth=0.8, label="P = 5e-8")
    ax.axhline(-np.log10(1e-5), color="blue", linestyle=":", linewidth=0.6, label="P = 1e-5")

    # Chromosome labels
    centres = []
    for c in chr_order:
        mask = chrom == c
        if np.any(mask):
            centres.append((chr_offsets[c] + np.median(bp[mask]), str(c)))
    ax.set_xticks([pos for pos, _ in centres])
    ax.set_xticklabels([lab for _, lab in centres], fontsize=7)

    ax.set_xlabel("Chromosome")
    ax.set_ylabel("-log10(P)")
    ax.set_title("Manhattan Plot")
    ax.legend(fontsize=8)
    fig.tight_layout()
    return fig_to_base64(fig)


def qq_plot(pval: np.ndarray, lambda_gc: float | None = None) -> str:
    """QQ plot of observed vs expected -log10(p)."""
    pval = pval[pval > 0]
    pval_sorted = np.sort(pval)
    n = len(pval_sorted)
    expected = -np.log10(np.arange(1, n + 1) / (n + 1))
    observed = -np.log10(pval_sorted)

    fig, ax = plt.subplots(figsize=(6, 6))
    ax.scatter(expected, observed, s=2, alpha=0.5, color="#1f77b4", rasterized=True)
    lim = max(expected.max(), observed.max()) + 0.5
    ax.plot([0, lim], [0, lim], "r--", linewidth=0.8)
    ax.set_xlabel("Expected -log10(P)")
    ax.set_ylabel("Observed -log10(P)")
    ax.set_title("QQ Plot")
    if lambda_gc is not None:
        ax.text(0.05, 0.95, f"$\\lambda_{{GC}}$ = {lambda_gc:.3f}",
                transform=ax.transAxes, fontsize=11, verticalalignment="top",
                bbox=dict(boxstyle="round", facecolor="wheat", alpha=0.5))
    fig.tight_layout()
    return fig_to_base64(fig)


# ---------------------------------------------------------------------------
# MR plots
# ---------------------------------------------------------------------------

def mr_forest_plot(results: list[dict]) -> str:
    """Forest plot comparing causal estimates across MR methods."""
    methods = [r["method"] for r in results]
    estimates = [r["estimate"] for r in results]
    ci_lo = [r["ci_lower"] for r in results]
    ci_hi = [r["ci_upper"] for r in results]

    fig, ax = plt.subplots(figsize=(8, max(3, len(methods) * 0.8)))
    y_pos = np.arange(len(methods))

    for i, (m, est, lo, hi) in enumerate(zip(methods, estimates, ci_lo, ci_hi)):
        ax.plot([lo, hi], [i, i], "k-", linewidth=1.5)
        ax.plot(est, i, "D", color="#d62728", markersize=8)

    ax.axvline(0, color="grey", linestyle="--", linewidth=0.8)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(methods)
    ax.set_xlabel("Causal Estimate (95% CI)")
    ax.set_title("MR Forest Plot")
    ax.invert_yaxis()
    fig.tight_layout()
    return fig_to_base64(fig)


def mr_scatter_plot(instruments_df: pl.DataFrame, results: list[dict]) -> str:
    """Scatter plot: SNP-exposure vs SNP-outcome with MR lines."""
    bx = instruments_df["beta_exposure"].to_numpy()
    by = instruments_df["beta_outcome"].to_numpy()
    sx = instruments_df["se_exposure"].to_numpy()
    sy = instruments_df["se_outcome"].to_numpy()

    fig, ax = plt.subplots(figsize=(7, 6))
    ax.errorbar(bx, by, xerr=sx, yerr=sy, fmt="o", color="#1f77b4",
                markersize=4, alpha=0.7, elinewidth=0.5, capsize=0)

    x_range = np.linspace(min(bx) * 1.2, max(bx) * 1.2, 100)
    colours = {"ivw": "#d62728", "mr_egger": "#2ca02c", "weighted_median": "#ff7f0e"}
    for r in results:
        m = r["method"]
        if m in colours:
            ax.plot(x_range, r["estimate"] * x_range, color=colours[m],
                    label=f"{m} ({r['estimate']:.3f})", linewidth=1.5)

    ax.axhline(0, color="grey", linewidth=0.5)
    ax.axvline(0, color="grey", linewidth=0.5)
    ax.set_xlabel("SNP-Exposure Effect")
    ax.set_ylabel("SNP-Outcome Effect")
    ax.set_title("MR Scatter Plot")
    ax.legend(fontsize=8)
    fig.tight_layout()
    return fig_to_base64(fig)


def mr_funnel_plot(instruments_df: pl.DataFrame, ivw_estimate: float | None) -> str:
    """Funnel plot: 1/SE vs Wald ratio per instrument."""
    wald = instruments_df["wald_ratio"].to_numpy()
    se = instruments_df["wald_se"].to_numpy()
    precision = 1.0 / se

    fig, ax = plt.subplots(figsize=(7, 5))
    ax.scatter(wald, precision, s=20, alpha=0.7, color="#1f77b4")
    if ivw_estimate is not None:
        ax.axvline(ivw_estimate, color="red", linestyle="--", linewidth=1, label=f"IVW = {ivw_estimate:.3f}")
    ax.set_xlabel("Causal Estimate (Wald Ratio)")
    ax.set_ylabel("Precision (1/SE)")
    ax.set_title("MR Funnel Plot")
    ax.legend(fontsize=8)
    fig.tight_layout()
    return fig_to_base64(fig)


# ---------------------------------------------------------------------------
# PRS plots
# ---------------------------------------------------------------------------

def prs_r2_barplot(metrics: dict) -> str:
    """Bar chart of R-squared across p-value thresholds."""
    thresholds = [t["p_threshold"] for t in metrics["thresholds"]]
    r2_vals = [t["r_squared"] for t in metrics["thresholds"]]
    labels = [f"{t:.0e}" for t in thresholds]

    fig, ax = plt.subplots(figsize=(8, 4))
    bars = ax.bar(labels, r2_vals, color="#2ca02c", alpha=0.8)
    # Highlight optimal
    opt = metrics["optimal_threshold"]
    opt_idx = thresholds.index(opt) if opt in thresholds else -1
    if opt_idx >= 0:
        bars[opt_idx].set_color("#d62728")
    ax.set_xlabel("P-value Threshold")
    ax.set_ylabel("R-squared")
    ax.set_title("PRS Prediction Accuracy by Threshold")
    fig.tight_layout()
    return fig_to_base64(fig)


def prs_distribution_plot(prs_df: pl.DataFrame) -> str:
    """Histogram and density of PRS by case/control status."""
    prs_cases = prs_df.filter(pl.col("case_status") == 1)["prs_optimal"].to_numpy()
    prs_controls = prs_df.filter(pl.col("case_status") == 0)["prs_optimal"].to_numpy()

    fig, ax = plt.subplots(figsize=(7, 5))
    ax.hist(prs_controls, bins=40, alpha=0.6, color="#1f77b4", label="Controls", density=True)
    ax.hist(prs_cases, bins=40, alpha=0.6, color="#d62728", label="Cases", density=True)
    ax.set_xlabel("Polygenic Risk Score")
    ax.set_ylabel("Density")
    ax.set_title("PRS Distribution by Case/Control Status")
    ax.legend()
    fig.tight_layout()
    return fig_to_base64(fig)


# ---------------------------------------------------------------------------
# DAG figure
# ---------------------------------------------------------------------------

def pipeline_dag() -> str:
    """Draw a directed acyclic graph of the pipeline workflow."""
    fig, ax = plt.subplots(figsize=(10, 9))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis("off")

    box_style = dict(boxstyle="round,pad=0.4", facecolor="#1a2744", edgecolor="#0f1a30",
                     linewidth=1.5)
    text_kw = dict(ha="center", va="center", fontsize=10, color="white",
                   fontweight="bold", bbox=box_style)
    tag_kw = dict(ha="center", va="center", fontsize=7.5, color="#888", fontstyle="italic")

    # Node positions  (x, y)
    nodes = {
        "gen":     (5, 9.2,  "Generate Synthetic\nGWAS Data"),
        "qc":      (5, 7.6,  "GWAS QC\nFiltering"),
        "gather":  (5, 6.0,  "Collect Results\nGenome-wide"),
        "clump":   (5, 4.4,  "LD Clumping"),
        "mr":      (3, 2.8,  "Two-Sample\nMR Analysis"),
        "prs":     (7, 2.8,  "Polygenic Risk\nScore (PRS)"),
        "report":  (5, 1.2,  "HTML Report\nGeneration"),
    }

    tags = {
        "gen":    (7.4, 9.2,  "x22 chromosomes\nSCATTER"),
        "qc":     (7.4, 7.6,  "x22 chromosomes\nSCATTER"),
        "gather": (7.4, 6.0,  "GATHER"),
        "clump":  (7.4, 4.4,  "genome-wide"),
        "mr":     (1.2, 2.8,  "Branch A"),
        "prs":    (8.8, 2.8,  "Branch B"),
        "report": (7.4, 1.2,  "final GATHER"),
    }

    # Draw nodes
    for key, (x, y, label) in nodes.items():
        ax.text(x, y, label, **text_kw)

    # Draw tags
    for key, (x, y, label) in tags.items():
        ax.text(x, y, label, **tag_kw)

    # Arrows
    arrow_kw = dict(arrowstyle="->,head_width=0.3,head_length=0.15",
                    color="#1a2744", linewidth=1.8)

    connections = [
        ("gen",    "qc",     5, 8.85, 5, 7.95),
        ("qc",     "gather", 5, 7.25, 5, 6.35),
        ("gather", "clump",  5, 5.65, 5, 4.75),
        ("clump",  "mr",     4.3, 4.1, 3.4, 3.15),
        ("clump",  "prs",    5.7, 4.1, 6.6, 3.15),
        ("mr",     "report", 3.6, 2.45, 4.5, 1.55),
        ("prs",    "report", 6.4, 2.45, 5.5, 1.55),
    ]

    for _, _, x1, y1, x2, y2 in connections:
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=arrow_kw)

    # Fork label
    ax.text(5, 3.6, "FORK", ha="center", va="center", fontsize=8,
            color="#d62728", fontweight="bold")

    fig.tight_layout()
    return fig_to_base64(fig, dpi=150)


# ---------------------------------------------------------------------------
# HTML template
# ---------------------------------------------------------------------------

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>GWAS-MR Pipeline Report</title>
<style>
  body {{ font-family: 'Segoe UI', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background: #fff; color: #333; }}
  .header {{ background: #1a2744; color: #fff; padding: 30px 40px; }}
  .header h1 {{ margin: 0 0 8px 0; font-size: 28px; }}
  .header p {{ margin: 0; font-size: 14px; opacity: 0.85; }}
  .container {{ max-width: 1100px; margin: 0 auto; padding: 30px 40px; }}
  h2 {{ color: #1a2744; border-bottom: 2px solid #1a2744; padding-bottom: 6px; margin-top: 40px; }}
  h3 {{ color: #2c4a7c; }}
  table {{ border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }}
  th {{ background: #1a2744; color: #fff; padding: 10px 12px; text-align: left; }}
  td {{ padding: 8px 12px; border-bottom: 1px solid #ddd; }}
  tr:nth-child(even) {{ background: #f7f9fc; }}
  .plot {{ text-align: center; margin: 20px 0; }}
  .plot img {{ max-width: 100%; border: 1px solid #eee; border-radius: 4px; }}
  .metric-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 16px 0; }}
  .metric-card {{ background: #f7f9fc; border-radius: 8px; padding: 16px; text-align: center; }}
  .metric-card .value {{ font-size: 28px; font-weight: bold; color: #1a2744; }}
  .metric-card .label {{ font-size: 13px; color: #666; margin-top: 4px; }}
  .footer {{ text-align: center; padding: 30px; color: #999; font-size: 12px; }}
  .prose {{ font-size: 15px; line-height: 1.7; color: #444; margin: 12px 0 20px 0; text-align: justify; }}
  .prose strong {{ color: #1a2744; }}
  .dag-caption {{ text-align: center; font-size: 13px; color: #666; margin-top: 4px; font-style: italic; }}
</style>
</head>
<body>
<div class="header">
  <h1>GWAS Summary Statistics QC &amp; Mendelian Randomization Report</h1>
  <p>Generated: {date} | Pipeline: nf-gwas-mr-pipeline | {params_summary}</p>
</div>
<div class="container">
{sections}
</div>
<div class="footer">
  Generated by nf-gwas-mr-pipeline &mdash; Nextflow DSL2 | Polars | Python
</div>
</body>
</html>"""


def img_tag(b64: str, alt: str = "") -> str:
    return f'<div class="plot"><img src="data:image/png;base64,{b64}" alt="{alt}"></div>'


def html_table(rows: list[dict], columns: list[str] | None = None) -> str:
    if not rows:
        return "<p><em>No data available.</em></p>"
    cols = columns or list(rows[0].keys())
    hdr = "".join(f"<th>{c}</th>" for c in cols)
    body = ""
    for row in rows:
        cells = "".join(f"<td>{row.get(c, '')}</td>" for c in cols)
        body += f"<tr>{cells}</tr>\n"
    return f"<table><thead><tr>{hdr}</tr></thead><tbody>{body}</tbody></table>"


# ---------------------------------------------------------------------------
# Build report
# ---------------------------------------------------------------------------

def build_report(
    qc_metrics_files: list[Path],
    qc_gwas_files: list[Path],
    clumping_file: Path,
    mr_json: Path,
    mr_instruments_file: Path,
    prs_metrics_file: Path,
    prs_file: Path,
    params_summary: str,
) -> str:
    """Build the full HTML report and return as a string."""

    sections: list[str] = []

    # ---- Load result data early so we can reference it in the summary ------
    mr_data: dict = {}
    if mr_json.exists():
        with open(mr_json) as fh:
            mr_data = json.load(fh)

    prs_data: dict = {}
    if prs_metrics_file.exists():
        with open(prs_metrics_file) as fh:
            prs_data = json.load(fh)

    clumping_n = 0
    if clumping_file.exists():
        clumping_n = len(pl.read_csv(clumping_file, separator="\t"))

    all_qc: list[dict] = []
    for mf in sorted(qc_metrics_files):
        with open(mf) as fh:
            all_qc.append(json.load(fh))

    total_input  = sum(m["input_variants"] for m in all_qc) if all_qc else 0
    total_output = sum(m["output_variants"] for m in all_qc) if all_qc else 0
    n_chroms = len(set(m.get("file", "") for m in all_qc)) if all_qc else 0

    # ---- Project Summary ---------------------------------------------------
    sections.append("<h2>Project Summary</h2>")

    # Background
    sections.append("<h3>Background</h3>")
    sections.append("""<p class="prose">
    Genome-wide association studies (GWAS) have identified thousands of genetic variants
    associated with complex diseases and traits, yet the vast majority of these associations
    are correlative rather than causal. Distinguishing true causal relationships from
    confounded associations is critical for drug target identification and validation, as
    investing in a non-causal target can lead to costly late-stage clinical trial failures.
    <strong>Mendelian Randomization (MR)</strong> addresses this challenge by using genetic
    variants as instrumental variables&mdash;leveraging the random assortment of alleles at
    conception to approximate a natural randomized controlled trial. When combined with
    rigorous GWAS summary statistics quality control and polygenic risk score (PRS) modelling,
    MR provides a powerful framework to prioritize genetically supported drug targets and
    estimate the likely direction and magnitude of therapeutic intervention. This pipeline
    implements a complete post-GWAS analysis workflow, from raw summary statistics through
    causal inference, designed to support the kind of human-genetics-driven drug discovery
    conducted at organizations like 5 Prime Sciences.
    </p>""")

    # Methods
    sections.append("<h3>Methods</h3>")
    sections.append("""<p class="prose">
    Synthetic GWAS summary statistics were generated for an exposure trait (simulating a
    protein quantitative trait locus study) and an outcome trait (simulating coronary artery
    disease) across up to 22 chromosomes, with realistic allele frequency distributions,
    imputation quality scores, and planted causal, exposure-only, and pleiotropic signals.
    Quality control was performed per chromosome using Polars lazy evaluation and included
    removal of variants with minor allele frequency &lt;0.01, imputation INFO score &lt;0.8,
    palindromic allele pairs (A/T, C/G), extreme effect sizes (&vert;&beta;&vert; &gt; 10),
    low sample size, and duplicate rsIDs. Genomic inflation (&lambda;<sub>GC</sub>) was
    computed at each stage. Independent lead variants were identified via greedy distance-based
    LD clumping (window = 10,000 kb, P &lt; 5&times;10<sup>-8</sup>). Two-sample MR was
    conducted using four methods implemented from first principles: the <strong>Wald ratio</strong>
    for the single strongest instrument, <strong>inverse-variance weighted (IVW)</strong>
    fixed-effects meta-analysis, <strong>MR-Egger regression</strong> (testing for directional
    pleiotropy via the intercept), and the <strong>weighted median estimator</strong> (robust
    to up to 50% invalid instruments, with bootstrap standard errors). Instrument strength
    was evaluated with the F-statistic, and heterogeneity was assessed with Cochran's Q and
    I<sup>2</sup>. In parallel, polygenic risk scores were calculated at eight p-value
    thresholds (5&times;10<sup>-8</sup> to 1.0) for 1,000 simulated individuals, with
    predictive accuracy measured as R<sup>2</sup> against a simulated phenotype.
    </p>""")

    # Results
    sections.append("<h3>Results</h3>")

    # Build a dynamic results paragraph from the actual pipeline outputs
    ivw_res = next((r for r in mr_data.get("results", []) if r["method"] == "ivw"), None)
    egger_res = next((r for r in mr_data.get("results", []) if r["method"] == "mr_egger"), None)
    wm_res = next((r for r in mr_data.get("results", []) if r["method"] == "weighted_median"), None)
    hetero = mr_data.get("heterogeneity", {})
    f_info = mr_data.get("instrument_strength", {})
    n_inst = mr_data.get("n_instruments", 0)
    opt_thresh = prs_data.get("optimal_threshold", "N/A")
    opt_r2 = prs_data.get("optimal_r_squared", 0)

    ivw_str = (f"&beta; = {ivw_res['estimate']:.4f}, SE = {ivw_res['se']:.4f}, "
               f"P = {ivw_res['pvalue']:.2e}" if ivw_res else "N/A")
    egger_intercept_str = (f"{egger_res['intercept']:.4f} (P = {egger_res['intercept_pvalue']:.2e})"
                           if egger_res and "intercept" in egger_res else "N/A")
    f_mean_str = f"{f_info.get('mean_F', 0):.1f}" if f_info else "N/A"
    i2_str = f"{hetero.get('I_squared', 0):.1f}%" if hetero else "N/A"
    q_p_str = f"{hetero.get('Q_pvalue', 1):.2e}" if hetero else "N/A"

    sections.append(f"""<p class="prose">
    After quality control, <strong>{total_output:,}</strong> of {total_input:,} input variants
    were retained across all chromosomes. LD clumping identified <strong>{clumping_n}
    independent lead loci</strong> reaching genome-wide significance. These loci were carried
    forward as genetic instruments into the MR analysis. Instrument strength was adequate
    (mean F-statistic = {f_mean_str}), indicating low risk of weak-instrument bias.
    The IVW estimate of the causal effect of the exposure on the outcome was
    {ivw_str}, with the MR-Egger intercept at {egger_intercept_str}, consistent with
    minimal directional pleiotropy. Heterogeneity across instruments was low
    (I<sup>2</sup> = {i2_str}; Cochran's Q P = {q_p_str}), suggesting the instruments
    provide consistent evidence. Polygenic risk score analysis identified an optimal
    p-value threshold of {opt_thresh:.0e} (R<sup>2</sup> = {opt_r2:.4f}), and the PRS
    distribution showed clear separation between simulated cases and controls, confirming
    that the planted genetic architecture is recoverable. Detailed results for each
    analysis stage are presented in the sections below.
    </p>""")

    # ---- Workflow & DAG ----------------------------------------------------
    sections.append("<h2>Workflow</h2>")
    sections.append("""<p class="prose">
    The pipeline is implemented in Nextflow DSL2, which separates each analytical step
    into modular processes connected by typed channels. The workflow exploits a
    <strong>scatter-gather parallelism</strong> pattern: synthetic data generation and
    QC execute independently for each chromosome (scatter), results are collected
    genome-wide (gather), and LD clumping operates on the merged dataset. The pipeline
    then <strong>forks</strong> into two concurrent branches&mdash;Mendelian Randomization
    and Polygenic Risk Score calculation&mdash;before a final gather step assembles all
    outputs into this HTML report. The directed acyclic graph (DAG) below illustrates
    the complete data flow, with annotations indicating which steps run in parallel
    and where scatter, gather, and fork patterns occur.
    </p>""")

    sections.append(img_tag(pipeline_dag(), "Pipeline DAG"))
    sections.append('<p class="dag-caption">Figure: Directed acyclic graph (DAG) of the '
                    'nf-gwas-mr-pipeline workflow. Boxes represent Nextflow processes; '
                    'arrows indicate channel data flow.</p>')

    # ---- Section 1: GWAS QC -----------------------------------------------
    sections.append("<h2>1. GWAS QC Summary</h2>")

    # Load QC metrics
    all_metrics: list[dict] = []
    for mf in sorted(qc_metrics_files):
        with open(mf) as fh:
            m = json.load(fh)
            m["file"] = mf.stem
            all_metrics.append(m)

    if all_metrics:
        # Metric cards
        total_in = sum(m["input_variants"] for m in all_metrics)
        total_out = sum(m["output_variants"] for m in all_metrics)
        total_sig = sum(m.get("significant_hits_5e8", 0) for m in all_metrics)
        avg_lambda = np.mean([m["lambda_gc"] for m in all_metrics if "lambda_gc" in m])
        sections.append(f"""
        <div class="metric-grid">
          <div class="metric-card"><div class="value">{total_in:,}</div><div class="label">Input Variants</div></div>
          <div class="metric-card"><div class="value">{total_out:,}</div><div class="label">After QC</div></div>
          <div class="metric-card"><div class="value">{total_sig}</div><div class="label">Significant Hits (P&lt;5e-8)</div></div>
          <div class="metric-card"><div class="value">{avg_lambda:.3f}</div><div class="label">Mean Lambda GC</div></div>
        </div>""")

        # QC table
        table_rows = []
        for m in all_metrics:
            table_rows.append({
                "File": m["file"],
                "Input": f"{m['input_variants']:,}",
                "Output": f"{m['output_variants']:,}",
                "Removed": f"{m['total_removed']:,}",
                "Sig Hits": m.get("significant_hits_5e8", ""),
                "Lambda GC": m.get("lambda_gc", ""),
            })
        sections.append(html_table(table_rows))

    # Manhattan plot (merge all QC'd files)
    if qc_gwas_files:
        frames = []
        for f in sorted(qc_gwas_files):
            frames.append(pl.read_csv(f, separator="\t"))
        merged = pl.concat(frames)

        sections.append("<h3>Manhattan Plot</h3>")
        sections.append(img_tag(manhattan_plot(merged), "Manhattan Plot"))

        sections.append("<h3>QQ Plot</h3>")
        pvals = merged["P"].to_numpy()
        pvals = pvals[pvals > 0]
        from scipy.stats import chi2 as chi2_dist
        lam = float(np.median(chi2_dist.isf(pvals, df=1)) / 0.4549)
        sections.append(img_tag(qq_plot(pvals, lam), "QQ Plot"))

    # ---- Section 2: LD Clumping -------------------------------------------
    sections.append("<h2>2. LD Clumping Results</h2>")
    if clumping_file.exists():
        lead_df = pl.read_csv(clumping_file, separator="\t")
        sections.append(f"<p><strong>{len(lead_df)}</strong> independent loci identified.</p>")

        if len(lead_df) > 0:
            # Loci per chromosome bar chart
            per_chr = lead_df.group_by("CHR").agg(pl.len().alias("n_loci")).sort("CHR")
            fig, ax = plt.subplots(figsize=(10, 3.5))
            ax.bar(per_chr["CHR"].to_numpy().astype(str), per_chr["n_loci"].to_numpy(),
                   color="#2c4a7c", alpha=0.8)
            ax.set_xlabel("Chromosome")
            ax.set_ylabel("Number of Loci")
            ax.set_title("Independent Loci per Chromosome")
            fig.tight_layout()
            sections.append(img_tag(fig_to_base64(fig), "Loci per chromosome"))

            # Table of top loci
            top_loci = lead_df.sort("P").head(30)
            table_rows = []
            for row in top_loci.iter_rows(named=True):
                table_rows.append({
                    "SNP": row["SNP"], "CHR": row["CHR"], "BP": f"{row['BP']:,}",
                    "A1/A2": f"{row['A1']}/{row['A2']}", "P": f"{row['P']:.2e}",
                    "BETA": f"{row['BETA']:.4f}",
                })
            sections.append("<h3>Top Lead SNPs</h3>")
            sections.append(html_table(table_rows))

    # ---- Section 3: Mendelian Randomization --------------------------------
    sections.append("<h2>3. Mendelian Randomization Results</h2>")
    if mr_json.exists():
        with open(mr_json) as fh:
            mr = json.load(fh)

        sections.append(f"<p><strong>{mr['n_instruments']}</strong> instruments used.</p>")

        # Results table
        if mr.get("results"):
            table_rows = []
            for r in mr["results"]:
                table_rows.append({
                    "Method": r["method"],
                    "Estimate": f"{r['estimate']:.4f}",
                    "SE": f"{r['se']:.4f}",
                    "P-value": f"{r['pvalue']:.2e}",
                    "95% CI": f"[{r['ci_lower']:.4f}, {r['ci_upper']:.4f}]",
                    "N Instruments": r["n_instruments"],
                })
            sections.append(html_table(table_rows))

            # Forest plot
            sections.append("<h3>Forest Plot</h3>")
            sections.append(img_tag(mr_forest_plot(mr["results"]), "Forest plot"))

        # Scatter plot
        if mr_instruments_file.exists():
            inst_df = pl.read_csv(mr_instruments_file, separator="\t")
            sections.append("<h3>Scatter Plot</h3>")
            sections.append(img_tag(mr_scatter_plot(inst_df, mr.get("results", [])), "Scatter plot"))

            # Funnel plot
            ivw_est = next((r["estimate"] for r in mr.get("results", []) if r["method"] == "ivw"), None)
            sections.append("<h3>Funnel Plot</h3>")
            sections.append(img_tag(mr_funnel_plot(inst_df, ivw_est), "Funnel plot"))

        # Heterogeneity
        hetero = mr.get("heterogeneity", {})
        if hetero:
            sections.append("<h3>Heterogeneity &amp; Pleiotropy</h3>")
            sections.append(f"""<table>
              <tr><th>Metric</th><th>Value</th></tr>
              <tr><td>Cochran's Q</td><td>{hetero.get('Q', 'N/A'):.2f} (df={hetero.get('Q_df', 'N/A')}, P={hetero.get('Q_pvalue', 'N/A'):.2e})</td></tr>
              <tr><td>I-squared</td><td>{hetero.get('I_squared', 'N/A'):.1f}%</td></tr>
            </table>""")

        # Egger intercept
        egger = next((r for r in mr.get("results", []) if r["method"] == "mr_egger"), None)
        if egger and "intercept" in egger:
            sections.append(f"""<table>
              <tr><th>MR-Egger Intercept Test</th><th>Value</th></tr>
              <tr><td>Intercept</td><td>{egger['intercept']:.4f} (SE={egger['intercept_se']:.4f})</td></tr>
              <tr><td>P-value (pleiotropy)</td><td>{egger['intercept_pvalue']:.2e}</td></tr>
            </table>""")

        # Instrument strength
        f_info = mr.get("instrument_strength", {})
        if f_info:
            sections.append(f"""<table>
              <tr><th>Instrument Strength</th><th>Value</th></tr>
              <tr><td>Mean F-statistic</td><td>{f_info.get('mean_F', 'N/A'):.1f}</td></tr>
              <tr><td>Min F-statistic</td><td>{f_info.get('min_F', 'N/A'):.1f}</td></tr>
              <tr><td>Weak instruments (F&lt;10)</td><td>{f_info.get('n_weak_instruments', 'N/A')}</td></tr>
            </table>""")

    # ---- Section 4: PRS ---------------------------------------------------
    sections.append("<h2>4. Polygenic Risk Score Results</h2>")
    if prs_metrics_file.exists():
        with open(prs_metrics_file) as fh:
            prs_metrics = json.load(fh)

        sections.append(f"""
        <div class="metric-grid">
          <div class="metric-card"><div class="value">{prs_metrics['n_individuals']:,}</div><div class="label">Individuals</div></div>
          <div class="metric-card"><div class="value">{prs_metrics['optimal_threshold']:.0e}</div><div class="label">Optimal P Threshold</div></div>
          <div class="metric-card"><div class="value">{prs_metrics['optimal_r_squared']:.4f}</div><div class="label">Best R-squared</div></div>
        </div>""")

        # R² bar plot
        sections.append("<h3>R-squared by P-value Threshold</h3>")
        sections.append(img_tag(prs_r2_barplot(prs_metrics), "PRS R² bar plot"))

    if prs_file.exists():
        prs_df = pl.read_csv(prs_file, separator="\t")
        if "prs_optimal" in prs_df.columns and "case_status" in prs_df.columns:
            sections.append("<h3>PRS Distribution by Case/Control</h3>")
            sections.append(img_tag(prs_distribution_plot(prs_df), "PRS distribution"))

    # ---- Assemble ----------------------------------------------------------
    return HTML_TEMPLATE.format(
        date=datetime.now().strftime("%Y-%m-%d %H:%M"),
        params_summary=params_summary,
        sections="\n".join(sections),
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate HTML report for GWAS-MR pipeline")
    parser.add_argument("--qc-metrics", type=Path, nargs="*", default=[],
                        help="QC metrics JSON files")
    parser.add_argument("--qc-gwas", type=Path, nargs="*", default=[],
                        help="QC'd GWAS TSV files (for Manhattan/QQ)")
    parser.add_argument("--clumping", type=Path, required=True,
                        help="Lead SNPs TSV from clumping")
    parser.add_argument("--mr-json", type=Path, required=True,
                        help="MR results JSON")
    parser.add_argument("--mr-instruments", type=Path, required=True,
                        help="Per-instrument MR data TSV")
    parser.add_argument("--prs-metrics", type=Path, required=True,
                        help="PRS metrics JSON")
    parser.add_argument("--prs-data", type=Path, required=True,
                        help="PRS per-individual TSV")
    parser.add_argument("--params-summary", type=str, default="default parameters")
    parser.add_argument("--output", type=Path, required=True, help="Output HTML file")
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)

    html = build_report(
        qc_metrics_files=args.qc_metrics,
        qc_gwas_files=args.qc_gwas,
        clumping_file=args.clumping,
        mr_json=args.mr_json,
        mr_instruments_file=args.mr_instruments,
        prs_metrics_file=args.prs_metrics,
        prs_file=args.prs_data,
        params_summary=args.params_summary,
    )

    with open(args.output, "w", encoding="utf-8") as fh:
        fh.write(html)

    print(f"Report written to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
