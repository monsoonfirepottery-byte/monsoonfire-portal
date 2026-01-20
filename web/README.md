# Monsoon Fire Portal — Dev Runbook (Web + Firebase)

This document is intentionally short and “copy/paste-able”.

## What runs where

- Web UI: Vite dev server (usually http://localhost:5173)
- Auth + Firestore: Firebase SDK (can talk to prod or emulators depending on how you run things)
- Cloud Functions (HTTP): called via a single base URL:
  - Defaults to **prod**: `https://us-central1-monsoonfire-portal.cloudfunctions.net`
  - Can be pointed at **emulators** via `VITE_FUNCTIONS_BASE_URL`

The web app is built to be a reference client for a future iOS app:
- explicit JSON requests
- tolerant parsing
- debugging metadata in the UI

---

## Run web against PROD (default)

From repo root:

```bash
cd web
npm install
npm run dev
