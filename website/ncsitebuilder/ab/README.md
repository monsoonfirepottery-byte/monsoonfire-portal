# A/B variants

Put variant-specific overrides under `ab/a/` and `ab/b/`.

The folder structure mirrors the site root. For example:

- Override `/index.html` with `ab/a/index.html`
- Override `/about/index.html` with `ab/b/about/index.html`

If a file does not exist in the variant folder, the server falls back to the main site file.

Run the server with the Node entrypoint:

```bash
node website/scripts/serve-ab.mjs --root website/ncsitebuilder
```

Or via npm:

```bash
npm run website:serve:ncsitebuilder:ab
```

Compatibility shim (legacy/optional):

```sh
node ./scripts/ps1-run.mjs website/ncsitebuilder/serve-ab.ps1
```

For primary Studio Brain onboarding and CI-style flows, prefer `node website/scripts/serve-ab.mjs` or `npm run website:serve:ncsitebuilder:ab`.

Force a variant with:

```
http://localhost:8000/?ab=a
http://localhost:8000/?ab=b
```
