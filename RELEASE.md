# Releasing

Distribution is a **GitHub Release asset** — there is no npm package. Users pin the
plugin by URL in their `myst.yml`.

## Steps

1. Make sure `main` is green (the **Test** workflow passes) and `npm run build`
   produces a working `dist/plugin.mjs`.
2. Create a new GitHub Release with a version tag (e.g. `v0.1.0`):
   - On GitHub: **Releases → Draft a new release → Choose a tag** (create `v0.1.0`).
   - Or with the CLI: `gh release create v0.1.0 --generate-notes`.
3. Publishing the release triggers `.github/workflows/release.yml`, which runs
   `npm install && npm run build` and attaches `dist/plugin.mjs` to the release via
   `softprops/action-gh-release`.

## How users consume it

Pin a specific tag:

```yaml
project:
  plugins:
    - https://github.com/developmentseed/myst-anywidget-static-export/releases/download/v0.1.0/plugin.mjs
```

Or always track the latest release:

```yaml
project:
  plugins:
    - https://github.com/developmentseed/myst-anywidget-static-export/releases/latest/download/plugin.mjs
```

## Versioning

Bump `version` in `package.json` to match the tag before releasing. The build is
deterministic, so re-running a release on the same commit reproduces the same
`dist/plugin.mjs`.
