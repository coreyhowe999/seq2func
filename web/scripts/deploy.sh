#!/bin/bash
# =============================================================================
# Deploy seq2func.win to Cloudflare Pages
# =============================================================================
#
# Builds the Next.js app and deploys to Cloudflare Pages with D1 + R2.
#
# Prerequisites:
#   1. npm install -g wrangler
#   2. wrangler login
#   3. Update wrangler.toml with your D1 database_id
#   4. Run database migration (first time only):
#      npx wrangler d1 execute nf-transcriptome-db --file=./migrations/0001_initial.sql
#
# Usage:
#   ./scripts/deploy.sh          # Deploy to production
#   ./scripts/deploy.sh preview  # Deploy to preview URL
#
# Author: Corey Howe
# =============================================================================

set -euo pipefail

MODE="${1:-production}"

echo "============================================"
echo "  Deploying seq2func.win to Cloudflare"
echo "  Mode: $MODE"
echo "============================================"
echo ""

# ── Step 1: Build the Next.js app ──────────────────────────────────────────
echo "Building Next.js app..."
npx @cloudflare/next-on-pages 2>&1 | tail -10
echo "  Build complete."

# ── Step 2: Deploy to Cloudflare Pages ─────────────────────────────────────
echo ""
echo "Deploying to Cloudflare Pages..."

if [ "$MODE" = "preview" ]; then
    npx wrangler pages deploy .vercel/output/static \
        --project-name=seq2func \
        --branch=preview
else
    npx wrangler pages deploy .vercel/output/static \
        --project-name=seq2func \
        --branch=main
fi

echo ""
echo "============================================"
echo "  Deployment Complete!"
echo "============================================"
echo ""

if [ "$MODE" = "production" ]; then
    echo "  Live at: https://seq2func.win"
    echo "  Also at: https://seq2func.pages.dev"
else
    echo "  Preview URL shown above"
fi

echo ""
echo "  Next steps:"
echo "    - Add custom domain (seq2func.win) in Cloudflare Pages dashboard"
echo "    - Configure DNS: CNAME @ → seq2func.pages.dev"
echo ""
