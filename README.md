# sv-ai-analysis-invoices — KHB Invoice Intelligence & Server Scans (`/v1`) Mission Control

Standalone React + Vite application for extracting KHB document headers & line items with Vision AI and syncing directly with the unauthenticated `/v1` Scan Backend API (`GET /v1/list/scans`, `GET /v1/{scanId}/scan`, `POST /v1/{scanId}/scan`, `POST /v1/list/scans`).

## Features

- **Server Scans (`/v1`) AI Mission Control**:
  - Connects to `GET /v1/list/scans` with full `/admin/scans`-compatible filtering & pagination.
  - Streams each scan's `imageUrl` and extracts KHB headers + line items using the KHB extraction protocol in `src/lib/ai.js`.
  - Updates the backend via `POST /v1/{scanId}/scan` (Single) or `POST /v1/list/scans` (Batch) with `reviewStatus = "APPROVED"`.
  - Automatically advances to the next page when a page finishes analyzing & syncing.
  - Includes **Table** and **Visual Cards** view modes plus a side-by-side **Scan Inspector** drawer.
- **Persistent Background Job Engine (`src/lib/jobManager.js`)**:
  - Both **Server Scans (`/v1`)** and **Local Batch Queue** run in a singleton background service in-memory with zero local database storage (Request -> Analyze -> Update pipeline).
- **Separate `/v1` API & Vision AI Settings (`src/components/SettingsModal.jsx`)**:
  - Configure AI Vision API (`base`, `key`, `model`) and `/v1` Scan Backend (`apiServerBase`, `v1ListScansPath`, `v1SingleScanPath`, `v1UpdateMode`) independently in the UI or via `VITE_*` environment variables.

## Local Development

```bash
npm install
npm run dev
```

## Deploying to Vercel

### Option 1: Deploy via Vercel CLI

```bash
npx vercel
# For production deployment:
npx vercel --prod
```

### Option 2: Deploy via GitHub + Vercel Dashboard

1. Push this repository to GitHub:
   ```bash
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. Import the repository at [vercel.com/new](https://vercel.com/new).
3. Vercel automatically detects **Vite** (`npm run build`, output directory `dist`) from `vercel.json`.
4. *(Optional)* Add default environment variables in Vercel Project Settings → Environment Variables (see `.env.example`), or configure them directly inside the app's **Settings** modal.
