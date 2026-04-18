#!/bin/bash
# =============================================================================
# Push Docker Images to GCP Artifact Registry
# =============================================================================
#
# Tags local Docker images and pushes them to Artifact Registry so that
# GCP VMs can pull them when running the pipeline.
#
# Usage:
#   ./scripts/push_containers.sh PROJECT_ID REGION
#   ./scripts/push_containers.sh my-project us-central1
#
# Author: Corey Howe
# =============================================================================

set -euo pipefail

PROJECT_ID="${1:?Usage: push_containers.sh PROJECT_ID [REGION]}"
REGION="${2:-us-central1}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/nf-transcriptome"

echo "Pushing containers to: $REGISTRY"
echo ""

# Authenticate Docker with Artifact Registry
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Push biotools container (TransDecoder + BLAST+ + Python) ─────────────
echo "Building and pushing biotools..."
docker build -t "${REGISTRY}/biotools:latest" \
    -f containers/Dockerfile.biotools . 2>&1 | tail -3
docker push "${REGISTRY}/biotools:latest" 2>&1 | tail -3
echo "  Done."

# ── Push ProstT5 container (PyTorch + GPU) ───────────────────────────────
echo "Building and pushing prostt5..."
docker build -t "${REGISTRY}/prostt5:latest" \
    -f containers/Dockerfile.prostt5 . 2>&1 | tail -3
docker push "${REGISTRY}/prostt5:latest" 2>&1 | tail -3
echo "  Done."

# ── Push FoldSeek container ──────────────────────────────────────────────
echo "Building and pushing foldseek..."
docker build -t "${REGISTRY}/foldseek:latest" \
    -f containers/Dockerfile.foldseek . 2>&1 | tail -3
docker push "${REGISTRY}/foldseek:latest" 2>&1 | tail -3
echo "  Done."

echo ""
echo "All containers pushed to $REGISTRY"
echo ""
echo "Update conf/gcp.config with these image paths if needed."
