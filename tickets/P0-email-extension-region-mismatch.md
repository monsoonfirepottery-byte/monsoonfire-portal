Status: Completed

# P0 - Email extension region mismatch blocks deployment

- Repo: portal
- Area: Backend
- Evidence: `extensions/firestore-send-email-5y3b.env` has `DATABASE_REGION=us-central1` and `firebaseextensions.v1beta.function/location=us-central1`.
- Recommendation: Reconfigure extension to actual Firestore region (nam5) and redeploy. Clean stale env files after confirm.
- Effort: S
- Risk: Med
- What to test: Create `/mail` doc and confirm delivery + status update.
