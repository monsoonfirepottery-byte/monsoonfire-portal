# Shared portal automation status

Publish a public-status-only GitHub snapshot on the portal host every 20 minutes. Write it atomically and retain the last good copy on failed reads. The staff portal reads the same-origin JSON, marks it stale after 65 minutes, and keeps the Today and Automation links functional.

- Verify the collector's request limit and failure behavior.
- Switch the staff consumer and tests to the snapshot.
- Stage a first snapshot, install the scheduled refresh without changing other jobs, and verify the live browser makes no GitHub API requests.
