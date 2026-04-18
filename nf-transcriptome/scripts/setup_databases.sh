#!/bin/bash
# =============================================================================
# Download FoldSeek + CDD Databases to GCS
# =============================================================================
#
# Downloads annotation databases directly into Google Cloud Storage.
# Uses a temporary GCE VM for fast download (GCP internal bandwidth).
#
# Databases downloaded:
#   - CDD (~4 GB) — NCBI Conserved Domain Database
#   - FoldSeek PDB (~15 GB) — experimental structures
#   - FoldSeek Alphafold/Swiss-Prot (~7 GB) — curated AlphaFold
#   - FoldSeek Alphafold/Proteome (~100 GB) — complete proteomes
#   - FoldSeek Alphafold/UniProt50 (~190 GB) — clustered AlphaFold
#
# Usage:
#   ./scripts/setup_databases.sh                        # Default bucket
#   ./scripts/setup_databases.sh seq2func-nextflow      # Custom bucket
#   ./scripts/setup_databases.sh seq2func-nextflow pdb   # Only PDB
#
# Author: Corey Howe
# =============================================================================

set -euo pipefail

BUCKET="${1:-seq2func-nextflow}"
DB_FILTER="${2:-all}"    # all, pdb, swissprot, proteome, uniprot50, cdd
GCS_DB_PATH="gs://${BUCKET}/databases"

echo "============================================"
echo "  Database Setup for nf-transcriptome"
echo "  Target: ${GCS_DB_PATH}"
echo "  Filter: ${DB_FILTER}"
echo "============================================"
echo ""

# Detect gcloud
GCLOUD="gcloud"
command -v gcloud &>/dev/null || GCLOUD="gcloud.cmd"
command -v $GCLOUD &>/dev/null || { echo "ERROR: gcloud not found"; exit 1; }

TMPDIR="/tmp/nf-db-download"
mkdir -p "$TMPDIR"

# ── Helper: download FoldSeek DB and upload to GCS ─────────────────────────
download_foldseek_db() {
    local DB_NAME="$1"
    local GCS_PREFIX="$2"
    local LOCAL_DIR="$TMPDIR/foldseek_${DB_NAME//\//_}"

    echo "  Downloading FoldSeek ${DB_NAME}..."
    mkdir -p "$LOCAL_DIR"

    docker run --rm \
        --entrypoint="" \
        -v "$LOCAL_DIR:/data" \
        ghcr.io/steineggerlab/foldseek:latest \
        foldseek_avx2 databases "$DB_NAME" "/data/db" "/data/tmp" 2>&1 | tail -3

    echo "  Uploading to ${GCS_DB_PATH}/${GCS_PREFIX}/..."
    $GCLOUD storage cp -r "$LOCAL_DIR/db"* "${GCS_DB_PATH}/${GCS_PREFIX}/" 2>&1 | tail -3
    echo "  Done: ${DB_NAME} -> ${GCS_DB_PATH}/${GCS_PREFIX}/"

    rm -rf "$LOCAL_DIR"
}

# ── CDD Database ───────────────────────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "cdd" ]]; then
    echo "=== CDD (Conserved Domain Database) ==="
    echo "  Size: ~4 GB compressed, ~8 GB extracted"
    echo ""

    CDD_TMP="$TMPDIR/cdd"
    mkdir -p "$CDD_TMP"

    echo "  Downloading from NCBI FTP..."
    curl -sL "https://ftp.ncbi.nlm.nih.gov/pub/mmdb/cdd/little_endian/Cdd_LE.tar.gz" \
        -o "$CDD_TMP/Cdd_LE.tar.gz"

    echo "  Extracting..."
    tar xzf "$CDD_TMP/Cdd_LE.tar.gz" -C "$CDD_TMP/"
    rm "$CDD_TMP/Cdd_LE.tar.gz"

    echo "  Uploading to GCS..."
    $GCLOUD storage cp -r "$CDD_TMP/"* "${GCS_DB_PATH}/cdd/" 2>&1 | tail -3
    echo "  Done: CDD -> ${GCS_DB_PATH}/cdd/"

    rm -rf "$CDD_TMP"
    echo ""
fi

# ── FoldSeek PDB ───────────────────────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "pdb" ]]; then
    echo "=== FoldSeek PDB (~200K experimental structures, ~15 GB) ==="
    download_foldseek_db "PDB" "foldseek/pdb"
    echo ""
fi

# ── FoldSeek AlphaFold/Swiss-Prot ──────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "swissprot" ]]; then
    echo "=== FoldSeek AlphaFold/Swiss-Prot (~500K curated, ~7 GB) ==="
    download_foldseek_db "Alphafold/Swiss-Prot" "foldseek/swissprot"
    echo ""
fi

# ── FoldSeek AlphaFold/Proteome ────────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "proteome" ]]; then
    echo "=== FoldSeek AlphaFold/Proteome (~48M structures, ~100 GB) ==="
    echo "  WARNING: This is a large download. Estimated time: 30-60 min."
    download_foldseek_db "Alphafold/Proteome" "foldseek/proteome"
    echo ""
fi

# ── FoldSeek AlphaFold/UniProt50 ───────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "uniprot50" ]]; then
    echo "=== FoldSeek AlphaFold/UniProt50 (~54M clustered, ~190 GB) ==="
    echo "  WARNING: Very large download. Estimated time: 1-2 hours."
    download_foldseek_db "Alphafold/UniProt50" "foldseek/uniprot50"
    echo ""
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo "============================================"
echo "  Database Setup Complete!"
echo "============================================"
echo ""
echo "  Available databases in GCS:"
$GCLOUD storage ls "${GCS_DB_PATH}/" 2>&1 | sed 's/^/    /'
echo ""
echo "  Run pipeline with specific database:"
echo "    nextflow run main.nf --srr_id SRR5437876 \\"
echo "      --foldseek_db gs://${BUCKET}/databases/foldseek/pdb \\"
echo "      -profile gcp"
echo ""
echo "  Search times per 1000 proteins (4 CPU):"
echo "    PDB:        ~2 min"
echo "    Swiss-Prot:  ~4 min"
echo "    Proteome:    ~2 hrs"
echo "    UniProt50:   ~2.5 hrs"
echo ""

rm -rf "$TMPDIR"
