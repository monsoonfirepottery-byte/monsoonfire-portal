# A/B variants

Put variant-specific overrides under `ab/a/` and `ab/b/`.

The folder structure mirrors the site root. For example:

- Override `/index.html` with `ab/a/index.html`
- Override `/about/index.html` with `ab/b/about/index.html`

If a file does not exist in the variant folder, the server falls back to the main site file.

Run the server with:

```
pwsh .\serve-ab.ps1
```

Force a variant with:

```
http://localhost:8000/?ab=a
http://localhost:8000/?ab=b
```
