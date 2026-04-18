#!/bin/bash
# =============================================================================
# Download FoldSeek + CDD Databases to GCS
# =============================================================================
#
# Downloads annotation databases directly into Google Cloud Storage so the
# GCP pipeline can access them without storing locally.
#
# Databases:
#   - FoldSeek PDB (~15 GB) — experimentally determined protein structures
#   - CDD (~4 GB) — NCBI Conserved Domain Database for RPS-BLAST
#
# Usage:
#   ./scripts/setup_databases.sh                    # Uses default bucket
#   ./scripts/setup_databases.sh my-bucket-name     # Custom bucket
#
# Prerequisites:
#   - gcloud CLI authenticated
#   - Docker installed
#   - GCS bucket created (run setup_gcp.sh first)
#
# Author: Corey Howe
# =============================================================================

set -euo pipefail

BUCKET="${1:-seq2func-nextflow}"
GCS_DB_PATH="gs://${BUCKET}/databases"
TMPDIR="/tmp/nf-db-download"

echo "============================================"
echo "  Database Setup for nf-transcriptome"
echo "  Target: ${GCS_DB_PATH}"
echo "============================================"
echo ""

# Check gcloud
if ! command -v gcloud &>/dev/null && ! command -v gcloud.cmd &>/dev/null; then
    echo "ERROR: gcloud not found. Install Google Cloud SDK first."
    exit 1
fi

# Use gcloud.cmd on Windows if needed
GCLOUD="gcloud"
command -v gcloud &>/dev/null || GCLOUD="gcloud.cmd"

mkdir -p "$TMPDIR"

# ── FoldSeek PDB Database ──────────────────────────────────────────────────
echo "=== Downloading FoldSeek PDB database ==="
echo "  This contains ~200K experimentally determined protein structures from PDB."
echo "  Size: ~15 GB. ETA: 5-15 minutes depending on connection."
echo ""

# Use a GCE VM to download directly into GCS (faster than local → GCS)
# Alternative: download locally then upload
echo "  Downloading via Docker + uploading to GCS..."

# Create a local temp directory for the download
FOLDSEEK_TMP="$TMPDIR/foldseek"
mkdir -p "$FOLDSEEK_TMP"

# Download using FoldSeek's databases command
docker run --rm \
    --entrypoint="" \
    -v "$FOLDSEEK_TMP:/data" \
    ghcr.io/steineggerlab/foldseek:latest \
    foldseek_avx2 databases PDB /data/pdb /data/tmp 2>&1 | tail -5

echo "  Uploading FoldSeek PDB to GCS..."
$GCLOUD storage cp -r "$FOLDSEEK_TMP/pdb*" "${GCS_DB_PATH}/foldseek/" 2>&1
echo "  FoldSeek PDB uploaded to ${GCS_DB_PATH}/foldseek/"

# Cleanup local temp
rm -rf "$FOLDSEEK_TMP"

# ── CDD Database ───────────────────────────────────────────────────────────
echo ""
echo "=== Downloading CDD (Conserved Domain Database) ==="
echo "  This contains position-specific scoring matrices for domain annotation."
echo "  Size: ~4 GB compressed, ~8 GB extracted."
echo ""

CDD_TMP="$TMPDIR/cdd"
mkdir -p "$CDD_TMP"

# Download CDD from NCBI FTP
echo "  Downloading from NCBI FTP..."
curl -sL "https://ftp.ncbi.nlm.nih.gov/pub/mmdb/cdd/little_endian/Cdd_LE.tar.gz" \
    -o "$CDD_TMP/Cdd_LE.tar.gz"

echo "  Extracting..."
tar xzf "$CDD_TMP/Cdd_LE.tar.gz" -C "$CDD_TMP/"
rm "$CDD_TMP/Cdd_LE.tar.gz"

echo "  Uploading CDD to GCS..."
$GCLOUD storage cp -r "$CDD_TMP/"* "${GCS_DB_PATH}/cdd/" 2>&1
echo "  CDD uploaded to ${GCS_DB_PATH}/cdd/"

# Cleanup
rm -rf "$CDD_TMP"

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Database Setup Complete!"
echo "============================================"
echo ""
echo "  FoldSeek PDB: ${GCS_DB_PATH}/foldseek/pdb"
echo "  CDD:          ${GCS_DB_PATH}/cdd/Cdd"
echo ""
echo "  These paths are already configured in conf/gcp.config."
echo ""
echo "  To run the full pipeline on GCP with all annotations:"
echo "    nextflow run main.nf --srr_id SRR5437876 \\"
echo "      --cdd_db gs://${BUCKET}/databases/cdd/Cdd \\"
echo "      --foldseek_db gs://${BUCKET}/databases/foldseek/pdb \\"
echo "      -profile gcp"
echo ""
echo "  Estimated storage costs: ~\$0.50/month (GCS Standard)"
echo ""

# Cleanup temp
rm -rf "$TMPDIR"
