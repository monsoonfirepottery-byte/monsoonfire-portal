Status: Completed

# P0 - Firebase Hosting config points to placeholder `public/` output

- Repo: root
- Area: Release / Hosting safety
- Evidence:
  - `firebase.json` hosting `public` directory is set to `public`
  - `public/index.html` is still the default "Welcome to Firebase Hosting" placeholder page
- Why this matters:
  - Any `firebase deploy` (without `--only`) will deploy hosting and publish this placeholder, not the portal.
  - Even if hosting is "not in scope", leaving a deployable placeholder increases release risk.
- Fix applied:
  - Set hosting `public` to `web/dist`.
  - Added hosting `predeploy` build step: `npm --prefix web run build`.
- Effort: M
- Risk: High
- What to test:
  - `firebase deploy --only hosting` (staging) serves the portal (not the placeholder).
  - SPA routes load correctly (rewrite to `/index.html`).
  - Portal can reach Functions at `https://us-central1-monsoonfire-portal.cloudfunctions.net` in prod build.
