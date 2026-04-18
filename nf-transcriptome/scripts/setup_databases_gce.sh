#!/bin/bash
# =============================================================================
# Download FoldSeek + CDD Databases via a temporary GCE VM
# =============================================================================
#
# Spins up a cheap GCE VM, downloads databases directly into GCS,
# then deletes the VM. This avoids downloading large files locally.
#
# Usage:
#   ./scripts/setup_databases_gce.sh                    # All databases
#   ./scripts/setup_databases_gce.sh pdb                # Just PDB
#   ./scripts/setup_databases_gce.sh swissprot          # Just Swiss-Prot
#
# Prerequisites:
#   - gcloud authenticated with project seq2func
#   - GCS bucket seq2func-nextflow exists
#
# Author: Corey Howe
# =============================================================================

set -euo pipefail

DB_FILTER="${1:-all}"
PROJECT="seq2func"
ZONE="us-central1-a"
BUCKET="seq2func-nextflow"
VM_NAME="db-downloader-$(date +%s)"
MACHINE="e2-standard-4"     # 4 vCPU, 16 GB — enough for downloads
DISK_SIZE="500"              # GB — enough for all databases

echo "============================================"
echo "  Database Download via GCE VM"
echo "  Databases: ${DB_FILTER}"
echo "  VM: ${VM_NAME} (${MACHINE})"
echo "============================================"
echo ""

# Build the startup script that runs on the VM
cat > /tmp/db_download_script.sh << 'VMSCRIPT'
#!/bin/bash
set -euo pipefail

BUCKET="BUCKET_PLACEHOLDER"
DB_FILTER="FILTER_PLACEHOLDER"
GCS_PATH="gs://${BUCKET}/databases"

echo "=== Starting database downloads ==="
apt-get update -qq && apt-get install -y -qq curl wget docker.io 2>/dev/null

# Start Docker
systemctl start docker

# ── CDD ────────────────────────────────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "cdd" ]]; then
    echo "=== Downloading CDD ==="
    mkdir -p /data/cdd
    curl -sL "https://ftp.ncbi.nlm.nih.gov/pub/mmdb/cdd/little_endian/Cdd_LE.tar.gz" \
        -o /data/cdd/Cdd_LE.tar.gz
    cd /data/cdd && tar xzf Cdd_LE.tar.gz && rm Cdd_LE.tar.gz
    gsutil -m cp -r /data/cdd/* "${GCS_PATH}/cdd/"
    echo "CDD uploaded to ${GCS_PATH}/cdd/"
    rm -rf /data/cdd
fi

# ── FoldSeek helper ────────────────────────────────────────────────────────
download_foldseek() {
    local DB_NAME="$1"
    local PREFIX="$2"
    echo "=== Downloading FoldSeek ${DB_NAME} ==="
    mkdir -p /data/fs
    docker run --rm -v /data/fs:/output ghcr.io/steineggerlab/foldseek:latest \
        bash -c "mkdir -p /tmp/fsdb && foldseek_avx2 databases '${DB_NAME}' /output/db /tmp/fsdb"
    gsutil -m cp -r /data/fs/db* "${GCS_PATH}/foldseek/${PREFIX}/"
    echo "FoldSeek ${DB_NAME} uploaded to ${GCS_PATH}/foldseek/${PREFIX}/"
    rm -rf /data/fs
}

# ── FoldSeek PDB ───────────────────────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "pdb" ]]; then
    download_foldseek "PDB" "pdb"
fi

# ── FoldSeek AlphaFold/Swiss-Prot ──────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "swissprot" ]]; then
    download_foldseek "Alphafold/Swiss-Prot" "swissprot"
fi

# ── FoldSeek AlphaFold/Proteome ────────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "proteome" ]]; then
    download_foldseek "Alphafold/Proteome" "proteome"
fi

# ── FoldSeek AlphaFold/UniProt50 ───────────────────────────────────────────
if [[ "$DB_FILTER" == "all" || "$DB_FILTER" == "uniprot50" ]]; then
    download_foldseek "Alphafold/UniProt50" "uniprot50"
fi

echo "=== All downloads complete ==="
gsutil ls "${GCS_PATH}/"

# Self-destruct: delete this VM
echo "Shutting down VM..."
shutdown -h now
VMSCRIPT

# Replace placeholders
sed -i "s/BUCKET_PLACEHOLDER/${BUCKET}/g" /tmp/db_download_script.sh
sed -i "s/FILTER_PLACEHOLDER/${DB_FILTER}/g" /tmp/db_download_script.sh

# Create the VM
echo "Creating GCE VM: ${VM_NAME}..."
gcloud compute instances create "$VM_NAME" \
    --project="$PROJECT" \
    --zone="$ZONE" \
    --machine-type="$MACHINE" \
    --boot-disk-size="${DISK_SIZE}GB" \
    --boot-disk-type=pd-ssd \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --scopes=storage-full \
    --metadata-from-file=startup-script=/tmp/db_download_script.sh \
    --no-restart-on-failure \
    2>&1

echo ""
echo "VM '${VM_NAME}' is starting. It will:"
echo "  1. Download databases directly to GCS (fast — GCP internal bandwidth)"
echo "  2. Self-destruct when done"
echo ""
echo "Monitor progress:"
echo "  gcloud compute ssh ${VM_NAME} --zone=${ZONE} -- 'tail -f /var/log/syslog'"
echo ""
echo "Or check GCS:"
echo "  gsutil ls gs://${BUCKET}/databases/"
echo ""
echo "Estimated time:"
echo "  PDB only:     ~5 min"
echo "  PDB + Swiss:  ~10 min"
echo "  All DBs:      ~2-3 hours"
echo ""
echo "Estimated cost: ~\$0.20 (e2-standard-4 spot for 3 hours)"
echo ""
echo "To delete the VM manually if needed:"
echo "  gcloud compute instances delete ${VM_NAME} --zone=${ZONE} --quiet"
