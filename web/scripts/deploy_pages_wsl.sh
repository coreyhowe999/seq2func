#!/bin/bash
# Deploy Next.js app to Cloudflare Pages via WSL (Windows next-on-pages has spawn-npx issues).
set -euo pipefail

export PATH="$HOME/bin/node/bin:$PATH"

cd /mnt/c/Users/corey/OneDrive/Desktop/Misc/resumes/5prime/web

# Copy to a WSL-native dir to avoid OneDrive permission issues during build.
TMPDIR="$HOME/seq2func-web-build"
rm -rf "$TMPDIR"
mkdir -p "$TMPDIR"

# Rsync source (exclude node_modules + build artifacts — we reinstall in the WSL dir).
rsync -a --exclude=node_modules --exclude=.next --exclude=.vercel \
  /mnt/c/Users/corey/OneDrive/Desktop/Misc/resumes/5prime/web/ "$TMPDIR/"

cd "$TMPDIR"
echo "=== npm install ==="
npm install --legacy-peer-deps --no-audit --no-fund 2>&1 | tail -3

echo "=== next-on-pages build ==="
npx @cloudflare/next-on-pages 2>&1 | tail -15

echo "=== wrangler pages deploy ==="
npx wrangler pages deploy .vercel/output/static --project-name=seq2func --branch=main --commit-dirty=true 2>&1 | tail -10

echo "DONE"
