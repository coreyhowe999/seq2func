#!/bin/bash
# =============================================================================
# GCP Project Setup for nf-transcriptome Pipeline
# =============================================================================
#
# This script sets up everything needed to run the transcriptome pipeline
# on Google Cloud Platform using Nextflow's google-batch executor.
#
# Prerequisites:
#   - Google Cloud SDK (gcloud) installed: https://cloud.google.com/sdk/install
#   - Authenticated: gcloud auth login
#   - Billing account linked to the project
#
# Usage:
#   ./scripts/setup_gcp.sh                     # Interactive — prompts for project ID
#   ./scripts/setup_gcp.sh my-project-id       # Non-interactive
#
# What this script does:
#   1. Creates (or selects) a GCP project
#   2. Enables required APIs (Batch, Compute, Storage, Artifact Registry)
#   3. Creates a GCS bucket for Nextflow work directory
#   4. Creates a service account with appropriate IAM roles
#   5. Downloads the service account key JSON
#   6. Creates an Artifact Registry repository for Docker images
#
# Author: Corey Howe — 5 Prime Sciences interview project
# =============================================================================

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
PROJECT_ID="${1:-}"
REGION="${GCP_REGION:-us-central1}"
BUCKET_NAME=""
SA_NAME="nextflow-pipeline"
SA_EMAIL=""
REPO_NAME="nf-transcriptome"
KEY_FILE="gcp-service-account-key.json"

echo "============================================"
echo "  GCP Setup for nf-transcriptome Pipeline"
echo "============================================"
echo ""

# ── Step 1: Project Setup ──────────────────────────────────────────────────
if [ -z "$PROJECT_ID" ]; then
    echo "Enter your GCP project ID (or press Enter to create a new one):"
    read -r PROJECT_ID
fi

if [ -z "$PROJECT_ID" ]; then
    PROJECT_ID="nf-transcriptome-$(date +%Y%m%d)"
    echo "Creating new project: $PROJECT_ID"
    gcloud projects create "$PROJECT_ID" --name="nf-transcriptome" 2>/dev/null || true
fi

echo "Using project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

BUCKET_NAME="${PROJECT_ID}-nextflow"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# ── Step 2: Enable APIs ───────────────────────────────────────────────────
echo ""
echo "Enabling required APIs..."
gcloud services enable \
    batch.googleapis.com \
    compute.googleapis.com \
    storage.googleapis.com \
    artifactregistry.googleapis.com \
    cloudresourcemanager.googleapis.com \
    iam.googleapis.com \
    --project="$PROJECT_ID"
echo "  APIs enabled."

# ── Step 3: Create GCS Bucket ─────────────────────────────────────────────
echo ""
echo "Creating GCS bucket: gs://$BUCKET_NAME"
gcloud storage buckets create "gs://$BUCKET_NAME" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --project="$PROJECT_ID" 2>/dev/null || echo "  Bucket already exists."

# Set lifecycle rule: delete work files older than 7 days (cost control)
cat > /tmp/lifecycle.json << 'EOF'
{
  "rule": [{
    "action": {"type": "Delete"},
    "condition": {"age": 7, "matchesPrefix": ["nextflow-work/"]}
  }]
}
EOF
gcloud storage buckets update "gs://$BUCKET_NAME" \
    --lifecycle-file=/tmp/lifecycle.json 2>/dev/null || true
echo "  Bucket ready with 7-day cleanup policy."

# ── Step 4: Create Service Account ────────────────────────────────────────
echo ""
echo "Creating service account: $SA_NAME"
gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Nextflow Pipeline Runner" \
    --project="$PROJECT_ID" 2>/dev/null || echo "  Service account already exists."

# Grant required roles
echo "  Granting IAM roles..."
ROLES=(
    "roles/batch.jobsEditor"          # Create and manage Batch jobs
    "roles/batch.agentReporter"       # Report job status
    "roles/compute.instanceAdmin.v1"  # Manage VM instances
    "roles/storage.objectAdmin"       # Read/write GCS objects
    "roles/iam.serviceAccountUser"    # Impersonate service accounts
    "roles/logging.logWriter"         # Write logs
    "roles/artifactregistry.reader"   # Pull container images
)

for role in "${ROLES[@]}"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$role" \
        --quiet 2>/dev/null
    echo "    $role"
done

# ── Step 5: Download Service Account Key ──────────────────────────────────
echo ""
echo "Creating service account key..."
gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$SA_EMAIL" \
    --project="$PROJECT_ID"
echo "  Key saved to: $KEY_FILE"
echo "  IMPORTANT: Add this to .gitignore and never commit it!"

# ── Step 6: Create Artifact Registry Repository ──────────────────────────
echo ""
echo "Creating Artifact Registry repository: $REPO_NAME"
gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID" 2>/dev/null || echo "  Repository already exists."

# Configure Docker auth for Artifact Registry
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  GCP Setup Complete!"
echo "============================================"
echo ""
echo "Project ID:      $PROJECT_ID"
echo "Region:          $REGION"
echo "GCS Bucket:      gs://$BUCKET_NAME"
echo "Service Account: $SA_EMAIL"
echo "Key File:        $KEY_FILE"
echo "Registry:        ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
echo ""
echo "Next steps:"
echo ""
echo "  1. Add to your .env.local (web app):"
echo "     GCP_PROJECT_ID=$PROJECT_ID"
echo "     GCP_BUCKET=$BUCKET_NAME"
echo "     GCP_REGION=$REGION"
echo "     GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/$KEY_FILE"
echo ""
echo "  2. Push container images:"
echo "     ./scripts/push_containers.sh $PROJECT_ID $REGION"
echo ""
echo "  3. Run the pipeline on GCP:"
echo "     nextflow run main.nf --srr_id SRR5437876 -profile gcp"
echo ""
echo "  4. Estimated costs per run (small dataset, spot VMs):"
echo "     ~\$0.50 - \$2.00 depending on dataset size"
echo "     Trinity (n2-highmem-8): ~\$0.15/hr spot"
echo "     ProstT5 (g2-standard-4 + L4 GPU): ~\$0.40/hr spot"
echo ""
