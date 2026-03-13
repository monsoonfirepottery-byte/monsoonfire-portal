# Curated Docs Manifest Contract

The next docs expansion should use a curated metadata manifest as the source of truth.

Current importer:
- [document-metadata-memory-normalize.mjs](/home/wuff/monsoonfire-portal/scripts/document-metadata-memory-normalize.mjs)

Accepted input shape today:
- JSON array
- JSON object with `rows[]`
- JSONL with one document metadata object per line

Recommended production record fields:
- `title`
- `path`
- `url`
- `mimeType`
- `sha256`
- `sizeBytes`
- `owner`
- `authors`
- `tags`
- `createdAt`
- `updatedAt`
- `excerpt`

Useful optional enrichment fields for the next docs pass:
- `collection`
- `docKind`
- `eraLabel`
- `relatedPeople`
- `relatedOrganizations`
- `sourceEvidence`

Defaults and behavior:
- `title` falls back to filename/path label if omitted.
- `mimeType` falls back to file extension if omitted.
- Stable identity prefers `sha256`, then path/title fallback.
- Full document text is not required in v1.
- `excerpt` should be short, human-meaningful metadata text rather than a full-content dump.
- `collection`, `docKind`, and `eraLabel` should be used to preserve curation intent without inventing filesystem structure.
- `relatedPeople`, `relatedOrganizations`, and `sourceEvidence` should be used when they materially improve relationship, workstream, or provenance signal.

Recommended production posture:
- Build or curate the manifest upstream.
- Keep provenance explicit.
- Avoid filesystem-crawl coupling in the ingestion contract for now.
- Use the manifest to represent both standalone docs and document inventories exported from other systems.

Minimal example:
```json
[
  {
    "title": "EV 10.0.2 Data Sheet",
    "path": "corp/marketing/2012/EV 10.0.2 Data Sheet.docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "sha256": "doc-demo-ev-10-0-2-data-sheet",
    "sizeBytes": 185112,
    "owner": "Micah Wyenn",
    "authors": ["Micah Wyenn", "Alex Laspinas"],
    "tags": ["product", "release", "datasheet", "gocmt"],
    "createdAt": "2012-09-14T17:53:19.000Z",
    "updatedAt": "2012-09-14T21:26:41.000Z",
    "excerpt": "Release highlights and go-to-market collateral for EV 10.0.2."
  }
]
```
