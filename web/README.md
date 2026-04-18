# seq2func.win — Transcriptome Pipeline Web App

NextJS web application for launching, monitoring, and exploring results from the de novo transcriptome assembly pipeline.

**Live:** https://seq2func.win

## Features

- Submit SRA accession IDs to launch pipeline runs
- Real-time pipeline status tracking with step-by-step progress
- Interactive protein annotations table with expandable detail panels
- Domain architecture SVG diagrams
- Color-coded amino acid sequence viewer
- FoldSeek structural homology results with PDB links
- Pipeline log viewer with level filtering and search
- Execution environment selector (Local Docker / GCP Cloud)

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (uses mock data by default)
npm run dev
# Open http://localhost:3000

# Switch to real database mode
# Edit .env.local: USE_MOCK_DATA=false
```

## Environment Variables

Copy `.env.local.example` to `.env.local` and configure:

```env
USE_MOCK_DATA=true              # Mock data for UI development
LOCAL_DB_PATH=./data/local.db   # SQLite database path
PIPELINE_DIR=../nf-transcriptome # Pipeline directory

# GCP (optional — for cloud pipeline execution)
GCP_PROJECT_ID=your_project
GCP_BUCKET=your_bucket
GCP_REGION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json

# Cloudflare (optional — for production deployment)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

## Deploy to Cloudflare Pages

```bash
# Login to Cloudflare
npx wrangler login

# Create D1 database
npx wrangler d1 create nf-transcriptome-db
# Update wrangler.toml with the database_id

# Run migration
npm run db:migrate:prod

# Deploy
npm run deploy
```

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS (dark navy/teal theme)
- **Database:** SQLite (local) / Cloudflare D1 (production)
- **Storage:** Cloudflare R2 (S3-compatible)
- **ORM:** Drizzle

## Author

Corey Howe — Built for 5 Prime Sciences interview
