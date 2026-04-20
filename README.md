# seq2func

**Sequence-to-function pipeline: from raw RNA-seq reads to annotated proteins in one click.**

🌐 **Live demo:** [seq2func.win](https://seq2func.win)
📂 **Components:** [`nf-transcriptome/`](nf-transcriptome/) (Nextflow pipeline) · [`web/`](web/) (Next.js frontend) · [`cloudflare-worker/`](cloudflare-worker/) (edge routing)

---

## What it does

Given an SRA accession (e.g. `DRR028935`), seq2func:

1. Downloads raw paired-end RNA-seq reads from EBI ENA
2. Runs quality control (FastQC) and adapter trimming (Trimmomatic)
3. Assembles a de novo transcriptome with **Trinity**
4. Predicts protein-coding ORFs with **TransDecoder**
5. In parallel, for each predicted protein:
   - Searches conserved domains against NCBI **CDD** (RPS-BLAST)
   - Predicts the 3Di structural alphabet with **ProstT5** (GPU-accelerated)
   - Finds structural homologs in **PDB** with **FoldSeek**
6. Merges all annotations into a unified JSON + TSV
7. Ingests results into a web UI for interactive exploration

Every step runs on its own right-sized GCP Batch VM (spot pricing); the orchestrator lives on the user's machine or a small VM.

---

## Example result

Run [`full_test_007`](https://seq2func.win/runs/full_test_007) processes `DRR028935` (*Botryococcus braunii* race B, a hydrocarbon-producing green alga).

Top FoldSeek hit on `TRINITY_DN0_c0_g1_i2.p1` (the only two proteins this tiny test dataset yields):

| Target | Identity | E-value | Description |
|--------|----------|---------|-------------|
| `6c6p` | 34.4% | 5.4e-45 | Human squalene epoxidase (SQLE, squalene monooxygenase) |
| `8urd` | 15.6% | 2.9e-21 | Bacillus flavin monooxygenase |

Squalene epoxidase is the biologically expected match — Botryococcus race B accumulates squalene-derived hydrocarbons, and SQLE is the enzyme that oxidizes squalene. The pipeline recovered that relationship from raw reads without any organism-specific prior.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser  ──►  seq2func.win  (Cloudflare DNS → Pages edge)               │
│                     │                                                      │
│                     ├─ Next.js 15 (edge runtime)                          │
│                     └─ API routes (Drizzle ORM → D1 binding)              │
│                              │                                             │
│  POST /api/pipeline/launch   ├─► Worker signs GCP JWT (RS256, Web Crypto) │
│                              └─► Cloud Run Admin API:                     │
│                                  run seq2func-nextflow Cloud Run Job      │
│                                        │                                   │
│                                        ▼                                   │
│                           Cloud Run Job container                          │
│                             (Nextflow + Java + gcloud + pipeline source) │
│                                        │                                   │
│                                        ▼                                   │
│                           Google Batch submits 1 VM per pipeline step:    │
│                             Trinity (n2-highmem-8) · CDD (e2-standard-4) │
│                             ProstT5 (g2+L4 GPU)    · FoldSeek (e2-std-4) │
│                             ... spot + on-demand depending on step        │
│                                        │                                   │
│                                        ▼                                   │
│                           GCS (workDir, databases, published results)    │
│                                        │                                   │
│  POST /api/pipeline/status  ◄──────────┤  (each step start/complete)     │
│  POST /api/pipeline/ingest  ◄──────────┘  (annotations + logs at end)    │
│                              ▼                                             │
│                           D1 (persistent)                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

The UI polls `/api/results/[runId]` while a run is in flight and renders live
per-step progress + log stream.

---

## Repo layout

| Path | Contents |
|------|----------|
| [`nf-transcriptome/`](nf-transcriptome/) | Nextflow DSL2 pipeline — 11 processes, GCP + local profiles. See [its README](nf-transcriptome/README.md) for per-step details. |
| [`nf-transcriptome/modules/`](nf-transcriptome/modules/) | One process per file (SRA_DOWNLOAD, TRINITY, CDD_SEARCH, PROSTT5_PREDICT, FOLDSEEK_SEARCH, MERGE_RESULTS, etc.) |
| [`nf-transcriptome/conf/gcp.config`](nf-transcriptome/conf/gcp.config) | Google Batch executor + per-process machine types and spot settings |
| [`nf-transcriptome/containers/`](nf-transcriptome/containers/) | Custom Dockerfiles (FoldSeek GCP-compatible image, ProstT5 with baked weights) |
| [`web/`](web/) | Next.js 15 app — run listing, detail pages, live log viewer, protein annotation tables with domain architecture + 3Di + FoldSeek hit viewers |
| [`web/src/lib/schema.ts`](web/src/lib/schema.ts) | Drizzle ORM schema: runs, steps, proteins, domains, sites, foldseek_hits, prostt5_predictions, logs |
| [`web/src/app/api/`](web/src/app/api/) | API routes: `/pipeline/launch`, `/pipeline/status` (called by Nextflow), `/pipeline/ingest/[runId]` (manual seed), `/results/[runId]`, `/pipeline/logs/[runId]`, `/runs` |
| [`cloudflare-worker/`](cloudflare-worker/) | Edge routing (currently unused — deploy is direct to Cloud Run) |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | CI: builds the web Docker image and deploys to Cloud Run on push to `main` |

---

## Tech stack

**Pipeline**
- [Nextflow](https://www.nextflow.io/) 25.10 (DSL2) · [Google Batch](https://cloud.google.com/batch) executor · Docker containers per step
- [Trinity](https://github.com/trinityrnaseq/trinityrnaseq) 2.15 (assembly) · [TransDecoder](https://github.com/TransDecoder/TransDecoder) 5.7 (ORF prediction)
- [FoldSeek](https://github.com/steineggerlab/foldseek) (3Di structural search) · [ProstT5](https://huggingface.co/Rostlab/ProstT5) (AA→3Di prediction, L4 GPU)
- [NCBI CDD](https://www.ncbi.nlm.nih.gov/Structure/cdd/cdd.shtml) + RPS-BLAST (conserved domain annotation)

**Web**
- [Next.js](https://nextjs.org/) 15 (App Router, edge runtime) — deployed to [Cloudflare Pages](https://pages.cloudflare.com/) via [`@cloudflare/next-on-pages`](https://github.com/cloudflare/next-on-pages)
- [Cloudflare D1](https://developers.cloudflare.com/d1/) for persistent storage (runs, proteins, annotations, logs); [Drizzle ORM](https://orm.drizzle.team/) over the D1 binding
- [Tailwind CSS](https://tailwindcss.com/)
- Pipeline launch: Worker signs a GCP OAuth JWT (RS256 via Web Crypto) from a stored service-account key, invokes the `seq2func-nextflow` Cloud Run Job, which runs Nextflow and POSTs annotations back to `/api/pipeline/ingest/<run_id>` on completion.

---

## Running locally

See [`nf-transcriptome/README.md`](nf-transcriptome/README.md) for pipeline setup (Docker, test datasets, skip flags for runs without GPU/databases) and [`web/README.md`](web/README.md) for the web app.

Fastest path to a working demo without any setup: visit [seq2func.win](https://seq2func.win) and open `full_test_007`.

---

Built by [Corey Howe](https://github.com/coreyhowe999) for a 5 Prime Sciences interview portfolio.
