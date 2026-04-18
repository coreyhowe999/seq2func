# nf-transcriptome

De novo transcriptome assembly and protein annotation pipeline built with Nextflow DSL2.

Takes an SRA accession ID, downloads RNA-seq reads from NCBI, assembles a transcriptome with Trinity, predicts protein-coding ORFs with TransDecoder, and annotates predicted proteins using CDD (conserved domains), ProstT5 (structural alphabet), and FoldSeek (structural homology).

## Quick Start

```bash
# Test with synthetic data (no SRA download, ~3 minutes)
python scripts/generate_test_data.py
nextflow run main.nf --reads 'data/test/*_{1,2}.fastq.gz' \
  --skip_prostt5 true --skip_foldseek true --skip_cdd true \
  -profile standard

# Run with real SRA data
nextflow run main.nf --srr_id SRR5437876 -profile standard

# Run on GCP (auto-provisions VMs with GPU)
nextflow run main.nf --srr_id SRR5437876 -profile gcp
```

## Pipeline Steps

```
SRA_DOWNLOAD → FASTQC → TRIMMOMATIC → FASTQC_TRIMMED → TRINITY
                                                          ↓
                                                   TRANSDECODER
                                                     ↓
                                    ┌────────────────┼────────────────┐
                                CDD_SEARCH     PROSTT5_PREDICT   FOLDSEEK
                                    └────────────────┼────────────────┘
                                                     ↓
                                               MERGE_RESULTS
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--srr_id` | null | SRA accession to download (e.g., SRR5437876) |
| `--reads` | null | Local FASTQ glob pattern (alternative to --srr_id) |
| `--run_id` | auto | Unique run identifier |
| `--outdir` | results | Output directory |
| `--api_url` | http://localhost:3000/api | Web app API for status updates |
| `--min_contig_len` | 200 | Trinity minimum contig length (bp) |
| `--min_orf_len` | 100 | TransDecoder minimum ORF length (aa) |
| `--max_proteins` | 500 | Cap proteins to annotate |
| `--evalue` | 0.01 | E-value threshold for searches |
| `--skip_prostt5` | false | Skip ProstT5 (no GPU needed) |
| `--skip_foldseek` | false | Skip FoldSeek (no database needed) |
| `--skip_cdd` | false | Skip CDD search (no database needed) |
| `--cdd_db` | data/cdd/Cdd | CDD database path |
| `--foldseek_db` | data/foldseek/pdb | FoldSeek database path |

## Profiles

| Profile | Description |
|---------|-------------|
| `standard` | Local Docker execution (default) |
| `test` | Small test dataset, skips annotation databases |
| `full` | Production resources (8 CPUs, 32 GB RAM) |
| `gpu` | Enables GPU for ProstT5 (NVIDIA Docker) |
| `gcp` | Google Cloud Batch execution with spot VMs |

## GCP Setup

```bash
# 1. Create project, bucket, service account
./scripts/setup_gcp.sh

# 2. Push container images to Artifact Registry
./scripts/push_containers.sh PROJECT_ID REGION

# 3. Run on GCP
export GOOGLE_APPLICATION_CREDENTIALS=gcp-service-account-key.json
nextflow run main.nf --srr_id SRR5437876 -profile gcp
```

## Output

```
results/{run_id}/
├── fastqc/          # Quality reports (HTML)
├── trimmomatic/     # Trimming logs
├── trinity/         # Assembly FASTA + gene-transcript map
├── transdecoder/    # Predicted proteins (PEP, BED, GFF3)
├── cdd/             # CDD domain annotations (JSON)
├── prostt5/         # 3Di structural predictions (FASTA)
├── foldseek/        # Structural homologs (JSON)
└── annotations/     # Merged annotations (JSON + TSV)
```

## Containers

| Image | Tools | Used By |
|-------|-------|---------|
| `ncbi/sra-tools:3.1.1` | prefetch, fasterq-dump | SRA_DOWNLOAD |
| `quay.io/biocontainers/fastqc:0.12.1--hdfd78af_0` | FastQC | FASTQC |
| `quay.io/biocontainers/trimmomatic:0.39--hdfd78af_2` | Trimmomatic | TRIMMOMATIC |
| `trinityrnaseq/trinityrnaseq:2.15.2` | Trinity | TRINITY |
| `trinityrnaseq/transdecoder:5.7.1` | TransDecoder, Python | TRANSDECODER, MERGE |
| `ncbi/blast:2.15.0` | RPS-BLAST | CDD_SEARCH |
| `nf-transcriptome-prostt5:latest` | ProstT5, PyTorch | PROSTT5 |
| `ghcr.io/steineggerlab/foldseek:latest` | FoldSeek | FOLDSEEK |

## Author

Corey Howe — Built for 5 Prime Sciences interview
