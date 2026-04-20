#!/bin/bash
# Build + push the Cloud Run Job runner image to GCP Artifact Registry.
set -euo pipefail

IMAGE="us-central1-docker.pkg.dev/seq2func/nf-transcriptome/nextflow-runner:latest"
cd /mnt/c/Users/corey/OneDrive/Desktop/Misc/resumes/5prime/nf-transcriptome

# Build context: the whole pipeline tree + the two runner scripts.
# We COPY from a staging dir so the Dockerfile paths are clean.
STAGE="/tmp/nf-runner-build"
rm -rf "$STAGE"
mkdir -p "$STAGE"
rsync -a --exclude=work --exclude=.nextflow --exclude='.nextflow.log*' --exclude=results --exclude=test_results \
    /mnt/c/Users/corey/OneDrive/Desktop/Misc/resumes/5prime/nf-transcriptome/ "$STAGE/nf-transcriptome/"
cp containers/runner_entrypoint.sh "$STAGE/"
cp containers/runner_ingest.mjs "$STAGE/"
cp containers/Dockerfile.runner "$STAGE/Dockerfile"

cd "$STAGE"
echo "=== docker build ==="
docker build -t "$IMAGE" . 2>&1 | tail -20
echo "=== docker push ==="
docker push "$IMAGE" 2>&1 | tail -5
echo "DONE: $IMAGE"
