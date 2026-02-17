# Website polish: conversion + trust

Status: Completed
Priority: P3
Severity: Sev4
Component: website
Impact: med
Tags: website, conversion, trust, seo

## Problem statement
The marketing website is close, but conversion and trust cues are still diffuse. Technical SEO basics and plain-language trust framing can be tightened without adding external services.

## Proposed solution
Deliver a fast polish pass:
- Lighthouse basics: page titles, meta descriptions, OG tags, favicon, `robots.txt`, `sitemap.xml`
- clearer primary CTA on key pages with less ambiguous copy
- trust framing: concise “what to expect” + policy summary links (no legal overloading)

## Acceptance criteria
- Major pages have unique title + description metadata.
- OG title/description/image and favicon are present.
- `robots.txt` and `sitemap.xml` exist and are valid.
- Primary CTA is clear and visually prioritized on top-value pages.
- A trust/policies summary section exists in plain language.

## Manual test checklist
1. Run local website build and verify metadata in page source.
2. Validate `robots.txt` and `sitemap.xml` are served.
3. Confirm CTA appears above fold on target pages and copy is unambiguous.
4. Confirm trust section links work and language is readable.
5. Run Lighthouse locally and compare baseline vs after polish.

## Notes for iOS parity (SwiftUI portability)
- Keep headline/CTA hierarchy and trust copy reusable for in-app marketing surfaces.
- Keep expectation-setting language platform-agnostic.
- Reuse the same value propositions for future App Store listing copy.

## Completion notes (2026-02-12)
- Added conversion/trust improvements without external services:
  - clearer primary CTA copy on `website/services/index.html` and `website/memberships/index.html`
  - new plain-language trust/expectations sections on both pages
  - skip-link accessibility affordance added to both pages for consistency with homepage UX
