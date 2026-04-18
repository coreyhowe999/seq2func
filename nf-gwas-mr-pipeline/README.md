# nf-gwas-mr-pipeline

A Nextflow DSL2 pipeline for **GWAS summary statistics quality control** and **two-sample Mendelian Randomization (MR)**, designed to go from raw GWAS results to causal drug-target evidence.

Built with fully containerised Python modules using **Polars** for high-performance data manipulation and implementing all statistical methods from scratch.

---

## Overview

This pipeline simulates a realistic bioinformatics workflow for a human-genetics-driven drug discovery company:

1. **Generate synthetic GWAS data** mimicking UK Biobank / Neale Lab summary statistics
2. **QC filtering** (MAF, INFO, palindromic SNPs, sample size, duplicates)
3. **LD clumping** to identify independent lead variants
4. **Two-sample Mendelian Randomization** (IVW, MR-Egger, Weighted Median, Wald Ratio)
5. **Polygenic Risk Score** calculation at multiple p-value thresholds
6. **HTML report** with Manhattan, QQ, forest, scatter, and funnel plots

---

## Pipeline DAG

```
                    ┌─────────────────────┐
                    │  Generate Synthetic  │
                    │   Data (x22 chrom)   │
                    │      [SCATTER]       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │     GWAS QC         │
                    │   (x22 chrom)       │
                    │      [SCATTER]       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Collect Results    │
                    │      [GATHER]        │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    LD Clumping       │
                    │   (genome-wide)      │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
          ┌─────────▼─────────┐ ┌─────────▼─────────┐
          │  MR Analysis      │ │  PRS Calculation   │
          │  (Branch A)       │ │  (Branch B)        │
          └─────────┬─────────┘ └─────────┬─────────┘
                    │                     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   HTML Report       │
                    │   Generation        │
                    └─────────────────────┘
```

---

## Quick Start

### Prerequisites

- [Nextflow](https://nextflow.io/) >= 23.04
- [Docker](https://docs.docker.com/get-docker/)

### Build the container

```bash
cd nf-gwas-mr-pipeline
docker build -t nf-gwas-mr-pipeline:latest containers/
```

### Run the pipeline

```bash
# Full run (22 chromosomes, 500K variants each)
nextflow run main.nf -profile local

# Quick test (5 chromosomes, 100K variants)
nextflow run main.nf -profile local --n_variants 100000 --n_chromosomes 5

# Cloud run (requires GCP setup)
nextflow run main.nf -profile gcp

# Simulated TRE environment
nextflow run main.nf -profile secure_env
```

### Run unit tests

```bash
pip install polars numpy scipy matplotlib pytest
pytest tests/ -v
```

---

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--n_variants` | 500,000 | Number of SNPs to simulate per chromosome |
| `--n_chromosomes` | 22 | Number of chromosomes (1-22) |
| `--n_samples_exposure` | 50,000 | Sample size for exposure GWAS |
| `--n_samples_outcome` | 50,000 | Sample size for outcome GWAS |
| `--gwas_pvalue_threshold` | 5e-8 | Genome-wide significance threshold |
| `--maf_threshold` | 0.01 | Minor allele frequency filter |
| `--info_threshold` | 0.8 | Imputation quality score filter |
| `--clumping_r2` | 0.001 | LD R-squared threshold |
| `--clumping_window` | 10,000 | Clumping window (kb) |
| `--mr_methods` | ivw, egger, weighted_median, wald_ratio | MR methods to run |
| `--outdir` | results | Output directory |

---

## Output Files

| File | Description |
|------|-------------|
| `results/pipeline_report.html` | Self-contained HTML report with all plots |
| `results/synthetic_data/` | Generated GWAS summary statistics per chromosome |
| `results/qc/` | QC'd summary statistics and metrics JSONs |
| `results/clumping/lead_snps.tsv` | Independent lead variants |
| `results/mr/mr_results.json` | MR causal estimates, heterogeneity, pleiotropy tests |
| `results/mr/mr_instruments.tsv` | Per-instrument Wald ratios for plotting |
| `results/prs/prs_scores.tsv` | PRS values per individual |
| `results/prs/prs_metrics.json` | PRS performance at each threshold |
| `results/pipeline_trace.txt` | Nextflow execution trace |
| `results/pipeline_timeline.html` | Nextflow timeline visualisation |
| `results/pipeline_execution_report.html` | Nextflow resource report |
| `results/pipeline_dag.html` | Pipeline DAG visualisation |

---

## Configuration Profiles

### `local` — Development

Runs on the local machine with Docker. Suitable for testing and small datasets. Limited to 4 CPUs and 8 GB RAM.

### `gcp` — Google Cloud Platform

Uses Google Batch to run tasks on cloud VMs. Spot (preemptible) instances are enabled for cost savings. Region is set to `northamerica-northeast1` (Montreal). Requires GCP project setup and a container image in Artifact Registry.

### `secure_env` — Trusted Research Environment (TRE)

Simulates execution inside a secure data enclave like the UK Biobank Research Analysis Platform. Key constraints:
- **Network isolation**: `--network none` prevents containers from accessing the internet
- **Read-only filesystem**: container filesystem is read-only
- **Comprehensive audit logging**: all task execution details are recorded
- **Restricted outputs**: results go to a designated directory for disclosure review

---

## Statistical Methods

### Mendelian Randomization

MR uses genetic variants as instrumental variables to estimate the causal effect of an exposure (e.g., protein levels) on an outcome (e.g., disease risk).

| Method | Description | Assumptions |
|--------|-------------|-------------|
| **Wald Ratio** | Single-instrument estimate: beta_out / beta_exp | All three IV assumptions |
| **IVW** | Fixed-effects meta-analysis of Wald ratios | No horizontal pleiotropy (InSIDE) |
| **MR-Egger** | Weighted regression allowing non-zero intercept | InSIDE, but relaxes "no pleiotropy" — intercept tests for directional pleiotropy |
| **Weighted Median** | Weighted median of Wald ratios (bootstrap SE) | Robust if up to 50% of instruments are invalid |

### Diagnostics

- **Cochran's Q**: tests for heterogeneity among instrument estimates
- **I-squared**: proportion of variability due to heterogeneity vs. chance
- **F-statistic**: instrument strength (F > 10 is the conventional threshold)
- **MR-Egger intercept**: tests for directional pleiotropy (intercept != 0 suggests bias)

### Polygenic Risk Score

PRS = sum(genotype_i * beta_i) across SNPs. Evaluated at multiple p-value thresholds (5e-8 to 1.0) to find the optimal threshold that maximises variance explained (R-squared).

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **Polars over Pandas** | 10-100x faster for columnar operations; lazy evaluation enables out-of-core processing for large GWAS files; better memory efficiency |
| **DSL2 modules** | Each process in its own file for maintainability; enables reuse across pipelines; clear separation of concerns |
| **Python over R** | MR methods implemented from scratch for transparency; avoids R dependency and TwoSampleMR package licensing; easier containerisation |
| **Single Dockerfile** | Simpler CI/CD; all tools available in every process; small image (~300 MB) |
| **Synthetic data** | Pipeline is self-contained; no external data dependencies; planted signals guarantee meaningful results |
| **Scatter-gather pattern** | Demonstrates distributed computing skills; each chromosome is independent; scales linearly to cloud/HPC |

---

## Testing

```bash
# Run all tests
pytest tests/ -v

# Run specific test file
pytest tests/test_mr.py -v

# Run with coverage
pytest tests/ --cov=bin/ --cov-report=term-missing
```

---

## References

1. Davey Smith G, Hemani G. Mendelian randomization: genetic anchors for causal inference in epidemiological studies. *Human Molecular Genetics*. 2014;23(R1):R89-R98.
2. Bowden J, et al. Mendelian randomization with invalid instruments: effect estimation and bias detection through Egger regression. *International Journal of Epidemiology*. 2015;44(2):512-525.
3. Bowden J, et al. Consistent estimation in Mendelian randomization with some invalid instruments using a weighted median estimator. *Genetic Epidemiology*. 2016;40(4):304-314.
4. Choi SW, et al. PRSice-2: Polygenic Risk Score software for biobank-scale data. *GigaScience*. 2019;8(7):giz082.
5. Di Tommaso P, et al. Nextflow enables reproducible computational workflows. *Nature Biotechnology*. 2017;35:316-319.
