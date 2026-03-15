# Marketing Announcements

Each file in this directory is a single announcement source document for the shared marketing feed.

Required fields
- `id`
- `status`: `draft | approved | archived`
- `audience.publicWebsite`
- `audience.portalMembers`
- `category`: `ops_update | event | spotlight | policy | offer`
- `publishAt`
- `expiresAt` (optional)
- `title`
- `summary`
- `body`
- `homepageTeaser`
- `portalPinned`
- `assetRefs[]`

Optional fields
- `ctaLabel`
- `ctaUrl`
- `assetRefs[].dropboxSource`
- `assetRefs[].alt`

Notes
- `body` should be plain text with blank lines between paragraphs.
- `assetRefs[].repoPath` must point to a real file in this repo.
- Public website assets should live under `website/` so the generator can expose a stable site path.
- Run `npm run marketing:announce:build` after approval.
- Run `npm run marketing:announce:sync` for a no-write dry run, then `npm run marketing:announce:sync:apply` after approval.
