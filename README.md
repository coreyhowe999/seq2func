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
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser  ──►  seq2func.win  (Cloudflare DNS → Cloud Run)               │
│                     │                                                     │
│                     ├─ Next.js 15 UI  (SSR + client-side)               │
│                     └─ API routes     (Node.js, Drizzle ORM, SQLite)    │
│                                                                           │
│  User CLI  ──►  Nextflow orchestrator (laptop or small GCE VM)          │
│                     │                                                     │
│                     └─ Google Batch  ──►  N× VMs, one per pipeline step │
│                                            ├─ Trinity (n2-highmem-8)    │
│                                            ├─ CDD (e2-standard-4)       │
│                                            ├─ ProstT5 (g2+L4 GPU)       │
│                                            ├─ FoldSeek (e2-standard-4)  │
│                                            └─ ... (spot VMs throughout) │
│                                                                           │
│  GCS  ◄──  workDir, databases (PDB 5.6 GiB, CDD), published results     │
└─────────────────────────────────────────────────────────────────────────┘
```

Pipeline status updates stream to the web API as each step starts/completes;
the UI polls `/api/results/[runId]` and renders live progress + logs.

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
- [Next.js](https://nextjs.org/) 15 (App Router, Server Components, SSR)
- [Drizzle ORM](https://orm.drizzle.team/) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Tailwind CSS](https://tailwindcss.com/)
- Deployed on [Google Cloud Run](https://cloud.google.com/run) (Cloudflare DNS → Cloud Run, no Worker layer in play currently)

---

## Running locally

See [`nf-transcriptome/README.md`](nf-transcriptome/README.md) for pipeline setup (Docker, test datasets, skip flags for runs without GPU/databases) and [`web/README.md`](web/README.md) for the web app.

Fastest path to a working demo without any setup: visit [seq2func.win](https://seq2func.win) and open `full_test_007`.

---

## Known issues

- **Pipeline launch from the web is not wired up.** Cloud Run containers have no `nextflow` binary and are capped at ~60 min per request, so `/api/pipeline/launch` fails with `spawn nextflow ENOENT`. Runs today are launched via `nextflow run main.nf -profile gcp` from a laptop or GCE VM, with Nextflow POSTing status updates to seq2func.win as each step completes.
- **SQLite on Cloud Run's `/tmp` is ephemeral.** The service is currently pinned to `min-instances=1, max-instances=1` so the DB survives between requests. A horizontal scale-out requires migrating to a persistent DB.

---

## Roadmap

### 1. Move web app to Cloudflare Workers + D1 (highest priority)

Three of the web's API routes depend on Node.js APIs (`child_process.spawn`, `fs.readFileSync`, `fs.createWriteStream`) that don't exist in Workers. In practice **all three are already broken in prod** for independent reasons — the launch `spawn` can't find a nextflow binary on Cloud Run, and the status route's `fs.readFileSync` looks for `annotations.json` on a Cloud Run `/tmp` that never received the file. Fixing each of them requires code changes anyway, so the Workers migration is a net-simpler refactor than it looks.

**Planned changes:**
- **[`web/src/lib/db.ts`](web/src/lib/db.ts)** — swap the better-sqlite3 singleton for a runtime-conditional driver: D1 when running on Workers (the `getD1Database()` helper already exists at line 150, just unused), better-sqlite3 when running locally. Drizzle schema already targets both.
- **[`web/src/app/api/pipeline/launch/route.ts`](web/src/app/api/pipeline/launch/route.ts)** — delete the `spawn(nextflow)` path. The endpoint becomes "create the run row + return the CLI command the user runs externally" until #2 below lands.
- **[`web/src/app/api/pipeline/status/route.ts`](web/src/app/api/pipeline/status/route.ts)** — delete the `fs.readFileSync(annotations.json)` block; [`/api/pipeline/ingest/[runId]`](web/src/app/api/pipeline/ingest/[runId]/route.ts) already replaces that path by accepting annotations in the request body.
- **Log streaming** — remove `fs.createWriteStream`; Nextflow already posts log batches via `POST /api/pipeline/status`, which writes directly to D1.
- **[`web/wrangler.toml`](web/wrangler.toml)** — D1 binding is already configured, just needs a valid `database_id`.
- **[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)** — swap `docker build` + `gcloud run deploy` for `npx @cloudflare/next-on-pages` + `wrangler pages deploy` (both already in `web/package.json scripts.deploy`).

**Wins:** persistent DB (no more `/tmp` resets on deploy), global edge latency, ~$0 hosting (free tier), removes three known-broken code paths, drops the `min=1/max=1` pinning hack.

**Estimated effort:** 2-3 hours + one D1 schema migration.

### 2. Proper pipeline launch from the web UI

Today the user runs `nextflow run main.nf ...` on their laptop (or a GCE VM), with Nextflow POSTing status updates to seq2func.win. The web UI's launch form is decorative. Options to make it real:

- **Dedicated GCE VM (cheapest, simplest):** always-on `e2-small` (~$5/mo) that polls a small "pending launches" table (or subscribes to Pub/Sub), runs `nextflow -bg` for each row. Web API writes the row. No container cold-start, no per-job billing overhead.
- **Cloud Run Job (serverless):** `/api/pipeline/launch` calls `gcloud run jobs execute seq2func-nextflow --update-env-vars=SRR_ID=...`. No VM to maintain. Cold-start ~10-30 s.
- **Cloud Workflows + Batch:** replace Nextflow with GCP's native orchestrator. Biggest rewrite, but native GCP observability and simpler IAM.

Recommendation: **Cloud Run Job.** Lowest ongoing cost, no infrastructure to babysit, and fits cleanly with the Workers migration (Worker → `fetch()` to Cloud Run Admin API).

### 3. Pipeline correctness + robustness

- **Fix Trinity memory mismatch.** [`modules/trinity.nf`](nf-transcriptome/modules/trinity.nf) hardcodes `--max_memory 64G` in the script while the GCP profile only reserves 32 GB on `n2-highmem-8`. Reads from `{task.memory}` instead.
- **Harden TransDecoder.Predict for tiny datasets.** With <5 ORFs the PWM training step crashes (missing `Rscript` + empty feature matrix). Detect low-ORF cases upstream and pass `--no_refine_starts` or skip the step.
- **Unchoke the real FoldSeek failure modes.** The `|| true` and `|| echo '{}'` fallbacks are gone (fixed in [`6596652`](https://github.com/coreyhowe999/seq2func/commit/6596652)) so failures now surface. Next: add a health check that asserts `wc -l foldseek_results.tsv > 0` before the step reports success.
- **Retry strategy for spot-VM preemptions.** Nextflow has `maxSpotAttempts=3` today; surface that in the step's status updates so the UI can show "retrying after preemption" instead of silently repeating.

### 4. Smaller polish

- Add the missing `GCP_SA_KEY` GitHub secret so auto-deploy actually works.
- Wire up a Linear/issue link from the run detail page for reporting pipeline failures.
- Add a small "launched from" badge (web-launched vs CLI-launched) so runs of different provenance are distinguishable.
- Generate shareable permalinks (`seq2func.win/r/<slug>`) for interview-ready demo links.

---

Built by [Corey Howe](https://github.com/coreyhowe999) for a 5 Prime Sciences interview portfolio.
