#!/bin/bash
# Cloud Run Job entrypoint — env-driven.
set -euo pipefail

: "${SRR_ID:?SRR_ID required}"
: "${RUN_ID:?RUN_ID required}"
: "${API_URL:=https://seq2func.win/api}"
: "${NF_PROFILE:=gcp}"
: "${GCP_PROJECT_ID:=seq2func}"
: "${GCP_REGION:=us-central1}"
: "${GCP_BUCKET:=seq2func-nextflow}"

export GCP_PROJECT_ID GCP_REGION GCP_BUCKET

cd /app/nf-transcriptome

# On Cloud Run Jobs the attached service account identity is already the
# default credential — no JSON key file needed, gcloud auto-discovers it.

echo "=== Launching Nextflow ==="
echo "  SRR_ID:      $SRR_ID"
echo "  RUN_ID:      $RUN_ID"
echo "  API_URL:     $API_URL"
echo "  NF_PROFILE:  $NF_PROFILE"
echo "  GCP_BUCKET:  $GCP_BUCKET"

mkdir -p /tmp/nf_results

nextflow run main.nf \
    --srr_id "$SRR_ID" \
    --run_id "$RUN_ID" \
    --outdir /tmp/nf_results \
    --api_url "$API_URL" \
    --gcp_project "$GCP_PROJECT_ID" \
    --gcp_region "$GCP_REGION" \
    --gcp_bucket "$GCP_BUCKET" \
    ${FOLDSEEK_DB:+--foldseek_db "$FOLDSEEK_DB"} \
    -profile "$NF_PROFILE" \
    2>&1 | tee "/tmp/nf_${RUN_ID}.log"

PIPELINE_EXIT=${PIPESTATUS[0]}
echo "=== Nextflow exit: $PIPELINE_EXIT ==="

# Ingest whatever we have — even on failure we want the partial logs + steps
# visible in the UI.
echo "=== Posting results to $API_URL/pipeline/ingest/$RUN_ID ==="
node /app/runner_ingest.mjs "$RUN_ID" \
    --results=/tmp/nf_results \
    --pipeline=/app/nf-transcriptome \
    --log=/tmp/nf_${RUN_ID}.log \
    --url="${API_URL%/api}" || {
    echo "Ingest failed — the run status will remain as last-reported by Nextflow."
    exit $PIPELINE_EXIT
}

exit $PIPELINE_EXIT
