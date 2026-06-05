# Plan: Extract `anywidget-static-export` into a standalone TypeScript MyST plugin repo

## Context

The `plugins/anywidget-static-export.mjs` plugin in `anywidget-experiments` has proven that
anywidget outputs can be rendered statically (no Jupyter kernel) in a MyST site, including the
hard cases — binary buffers, cross-widget interop, jslinks, lonboard. It now lives as a single
920-line plain-JS file embedded inside an experiments repo, which is a poor home for something
others might depend on.

The goal is a clean, standalone, **maintainable TypeScript** repository that does one thing:
ship this MyST plugin, with proper structure, tests, build/release CI, and usage docs. The
existing `anywidget-experiments` repo is **left untouched** as a frozen snapshot showing the
origin of the experiment; the new repo links back to it for provenance and the deep design
notes.

This plan is a self-contained handoff: it is meant to be carried into a **fresh empty repo and a
fresh Claude session** and executed there. It references the source repo by path
(`/Users/sanjay/seed/anywidget-experiments`) — keep a clone or copy of that repo available when
executing, since you will be copying several files out of it.

### Decisions already made (do not re-litigate)
- **Repo / package name:** `myst-anywidget-static-export`
- **Distribution:** GitHub Release asset, exactly like `jupyter-book/blog-plugin`. CI builds
  `dist/plugin.mjs` and attaches it to a GitHub Release. Users reference it by URL in `myst.yml`.
  **No npm publish.**
- **Runtime handling:** Extract the embedded ~500-line client-side host runtime into its own
  type-checked TS source under `src/runtime/`, and bundle-it-to-a-string at build time (details
  below). Do **not** keep it as an inline string literal.
- **Docs:** A minimal but real MyST demo site under `docs/` using 1–2 tiny self-contained
  pre-built widgets (e.g. a counter). Light Python deps, fast CI, deployable to gh-pages. No
  lonboard/geopandas in the demo.

### Reference repo
Model structure, tooling, and CI on `https://github.com/jupyter-book/blog-plugin`
(TS in `src/`, tests in `tests/`, demo MyST site in `docs/`, esbuild → `dist/plugin.mjs`,
`noxfile.py` + `uv` orchestration, three workflows: test / release / deploy).

---

## Source artifact (what we are extracting)

All paths below are in `/Users/sanjay/seed/anywidget-experiments`:

| Source | Role | Destination in new repo |
|---|---|---|
| `plugins/anywidget-static-export.mjs` (920 LOC) | The plugin: transform + asset emission + embedded runtime | Split into `src/plugin.ts`, `src/transform/*.ts`, `src/runtime/*.ts` |
| `plugins/README.md` (308 LOC, "9 hacks") | Design notes / load-bearing workarounds | `docs/design-notes.md` (linked from README) |
| `tests/static-export.test.mjs` (9 cases) | Behavior tests | `tests/transform.test.ts` |
| `tests/helpers.mjs` | Test scaffolding (transform loader, temp dirs, AST builders) | `tests/helpers.ts` |
| `tests/fixtures/*.ipynb` + `tests/fixtures/build.mjs` | Hand-built notebook fixtures + generator | `tests/fixtures/` (copy as-is) |
| `vitest.config.mjs` | Vitest config | `vitest.config.ts` |
| `docs/upstream-*.md`, `docs/lonboard-*.md` | Upstream-bug write-ups for context | `docs/upstream/` (copy, optional but recommended) |

### Plugin internals worth knowing before refactoring
- Plugin export shape (bottom of file): `export default { name, transforms: [{ name, stage: 'project', plugin: transformPlugin }] }`. Plugin API surface used is **only** the transform hook — no directives/roles.
- `transformPlugin` is an async factory returning `(tree, file) => void`. It reads the source
  `.ipynb` from `file.path`, pulls widget state from
  `notebook.metadata.widgets['application/vnd.jupyter.widget-state+json'].state`, walks the AST
  for `output` nodes carrying `application/vnd.jupyter.widget-view+json`, and rewrites them to
  `type: 'anywidget'` nodes while emitting sidecar assets into `_widget_assets/`.
- Pure-logic helpers (easy first TS targets, no I/O): `findOutputs`, `findOutputsWithParent`,
  `findAnywidgetDescendant`, `buildSubModels`, `collectJsLinks`, `buildInitialModel`,
  `shortHash`. These take/return plain objects → annotate with AST + widget-state types.
- I/O + emission: `writeFileIfChanged`, `emitStaticWidgetAssets`, `rewriteOutputNodeToAnywidget`.
- **The runtime embedding** (the key refactor): `RUNTIME_SOURCE` is a `String.raw` template
  literal at lines **181–680**. It is (a) written verbatim to disk as the shared host module
  `myst-anywidget-static-host.mjs`, and (b) prepended by `buildWrapperModule(source)` to each
  per-widget wrapper. The runtime exports `initializeStaticWidget` / `renderStaticWidget` plus
  internal machinery: base64→ArrayBuffer + `put_buffers` port, `__MystEmitter`, `__MystSubModel`
  proxy, a per-page scoped model registry (`window.__myst_anywidget_hosts` keyed by
  `document.baseURI`), and shadow-DOM CSS injection.

---

## Target repo structure

```
myst-anywidget-static-export/
├── src/
│   ├── plugin.ts                 # default export: { name, transforms:[...] }; the transform factory
│   ├── transform/
│   │   ├── walk.ts               # findOutputs, findOutputsWithParent
│   │   ├── widget-state.ts       # findAnywidgetDescendant, buildSubModels, collectJsLinks, buildInitialModel
│   │   ├── emit.ts               # writeFileIfChanged, emitStaticWidgetAssets, buildWrapperModule, shortHash
│   │   └── rewrite.ts            # rewriteOutputNodeToAnywidget
│   ├── runtime/
│   │   ├── index.ts              # entry: exports initializeStaticWidget, renderStaticWidget (was RUNTIME_SOURCE body)
│   │   ├── buffers.ts            # base64 + put_buffers/apply_buffers port
│   │   ├── emitter.ts            # __MystEmitter
│   │   ├── submodel.ts           # __MystSubModel proxy
│   │   ├── registry.ts           # scoped host registry, jslink wiring, getModel/waitForModel
│   │   └── css.ts                # shadow-DOM CSS injection
│   ├── generated/
│   │   └── runtime-source.ts     # BUILD ARTIFACT: `export const RUNTIME_SOURCE = "...";` (gitignored)
│   └── types.ts                  # AST node, widget-state, plugin-API typings
├── tests/
│   ├── transform.test.ts
│   ├── helpers.ts
│   └── fixtures/                 # *.ipynb + build.mjs
├── docs/                         # minimal MyST demo site (see below)
│   ├── myst.yml
│   ├── index.md
│   └── widgets/counter/          # tiny self-contained anywidget for the demo
├── scripts/
│   └── build.mjs                 # 2-pass esbuild: runtime→string, then plugin→dist/plugin.mjs
├── .github/workflows/
│   ├── test.yml
│   ├── release.yml
│   └── deploy.yml
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── noxfile.py
├── RELEASE.md
├── README.md
└── .gitignore
```

---

## The build pipeline (the one genuinely new piece)

The transform needs the runtime as a **string** (to write to disk and to prepend into wrappers),
but we want the runtime to be **real type-checked TS**. Resolve this with a two-pass build in
`scripts/build.mjs`:

1. **Bundle the runtime to a string.** esbuild bundle `src/runtime/index.ts` with
   `platform: 'browser'`, `format: 'esm'`, `bundle: true`, `write: false`, `target: 'es2020'`.
   Grab `result.outputFiles[0].text`.
2. **Generate the source module.** Write
   `src/generated/runtime-source.ts` =
   `export const RUNTIME_SOURCE = ${JSON.stringify(text)};\n`.
   (`src/generated/` is gitignored; it's a derived artifact.)
3. **Bundle the plugin.** esbuild bundle `src/plugin.ts` (which imports
   `./generated/runtime-source.js`) with `platform: 'node'`, `format: 'esm'`,
   `outfile: 'dist/plugin.mjs'`, `bundle: true`.

`src/transform/emit.ts` imports `RUNTIME_SOURCE` from `../generated/runtime-source.js` and uses
it exactly as the original `emitStaticWidgetAssets` / `buildWrapperModule` did — writing the host
module and prepending it into each wrapper. The wrapper-construction string template
(`buildWrapperModule`) stays a string template; only its `RUNTIME_SOURCE` input changes source.

> Order matters: the runtime bundle (step 1+2) must run before typechecking/plugin bundle,
> because `src/plugin.ts` imports the generated module. Make `npm run build` run all three steps;
> make `typecheck`/`test` depend on `build` having produced `src/generated/runtime-source.ts`.

---

## Key files to author

### `package.json`
- `"type": "module"`, name `myst-anywidget-static-export`, `"private": true` is fine (no npm publish).
- devDeps: `esbuild`, `vitest`, `typescript`, `@types/node`. Pull MyST AST/common types if useful
  (`myst-common`) — but the source uses no MyST runtime imports, so keep deps minimal; prefer
  local typings in `src/types.ts` over heavyweight deps unless a published type fits cleanly.
- Scripts (mirror blog-plugin's shape):
  - `"build": "node scripts/build.mjs"`
  - `"typecheck": "tsc --noEmit"`
  - `"test": "npm run build && vitest run"`
  - `"test:watch": "vitest"`
  - `"build:docs": "npm run build && cp dist/plugin.mjs docs/plugin.mjs && cd docs && npx mystmd build --html"`

### `tsconfig.json`
Copy blog-plugin's: `target es2022`, `module nodenext`, `strict`, `isolatedModules`,
`moduleDetection: force`, `outDir: dist`, `sourceMap`. **Two lib contexts** — the runtime needs
DOM types. Either set `"lib": ["es2022", "dom"]` globally, or give `src/runtime/` its own
`tsconfig` with `dom` lib while the transform side stays node-only. Recommend a global
`["es2022","dom"]` for simplicity unless the strictness bites.

### `vitest.config.ts`
Port `vitest.config.mjs`: `environment: 'node'`, `globals: true`. Vitest runs TS natively.
Tests exercise the **transform** (node side); they do not need the DOM runtime to execute, only
to assert that runtime/wrapper files were emitted. Keep `tests/helpers.ts`'s transform-loader
pattern but point it at the built `dist/plugin.mjs` (or import `src/plugin.ts` directly — prefer
importing source so failures map to TS lines; `npm test` already builds the runtime first).

### `scripts/build.mjs`
Implements the 3 steps above. No external deps beyond esbuild + node built-ins.

### `noxfile.py`
Copy blog-plugin's nearly verbatim: `test` (build plugin, `npm test`), `build`/`docs`
(install mystmd, build plugin, `cp dist/plugin.mjs docs/plugin.mjs`, `myst build --html`),
`docs-live`, `clean`. Uses `uv|virtualenv` backend.

### CI workflows (copy blog-plugin, adjust names)
- `test.yml`: on push (main) + PR → `astral-sh/setup-uv` → `uv tool install nox` → `nox -s test`.
- `release.yml`: on `release: published` → `npm install` → `npm run build` →
  `softprops/action-gh-release@v2` attaching `dist/plugin.mjs`. Needs `permissions: contents: write`.
- `deploy.yml`: gh-pages, `nox -s docs`, upload `docs/_build/html`. Demo must be pre-built; if a
  fixture notebook needs execution, add a pre-execute step (`jupyter nbconvert --execute`) — but
  prefer committing already-executed demo notebooks so deploy needs no kernel.

### `docs/` demo site
- `docs/myst.yml`: `project.plugins: [plugin.mjs]` (the copied build artifact), a short toc.
- `docs/index.md`: usage explainer + an embedded executed demo notebook.
- `docs/widgets/counter/`: a tiny anywidget (TS or JS `_esm`) — reuse/trim
  `widgets/typed_counter` or `widgets/counter_widget` from the source repo. Commit the demo
  notebook **already executed** (with widget-state metadata) so the plugin has buffers/state to
  transform and CI needs no Python kernel for the widget.

### `README.md`
- One-paragraph what/why; link to the live demo (gh-pages) and to the origin repo
  `anywidget-experiments` for provenance + deep design notes.
- Install/usage: the `myst.yml` snippet referencing the release-asset URL
  (`https://github.com/<org>/myst-anywidget-static-export/releases/latest/download/plugin.mjs`).
- Dev: `nox -s test`, `nox -s docs-live`.
- Link to `docs/design-notes.md` (ported `plugins/README.md`) and `docs/upstream/`.

### `RELEASE.md`
Copy blog-plugin's: create a GitHub Release/tag → `release.yml` builds and attaches
`dist/plugin.mjs` → users pin by URL.

### `.gitignore`
`/node_modules/`, `/dist/`, `/_build/`, `docs/_build/`, `docs/plugin.mjs`,
`src/generated/`, `__pycache__/`.

---

## Execution order (suggested)

1. Scaffold repo: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`,
   `scripts/build.mjs` (stubbed), `src/types.ts`.
2. Port the **runtime** first into `src/runtime/*.ts` (split by concern), get `npm run build`
   step 1+2 producing `src/generated/runtime-source.ts`. Typecheck the runtime in isolation.
3. Port the **transform** helpers (`walk.ts`, `widget-state.ts`, `rewrite.ts`) and `emit.ts`
   (importing the generated runtime), then `src/plugin.ts` re-assembling the
   `export default { name, transforms }` shape. Get step 3 producing `dist/plugin.mjs`.
4. Port tests + fixtures (`tests/*.ts`, copy `tests/fixtures/` verbatim). Make all 9 cases pass.
5. Add `noxfile.py` + three CI workflows.
6. Build the minimal `docs/` demo; verify it builds to static HTML with a rendered widget.
7. Port `plugins/README.md` → `docs/design-notes.md`; copy `docs/upstream-*.md`; write `README.md`
   + `RELEASE.md`.

---

## Verification (end-to-end)

- **Unit/behavior:** `nox -s test` (or `npm test`) — all 9 ported cases green. They assert node
  rewriting, VBox unwrapping, base64 buffers, submodel bundling, CSS inlining (and that
  `node.css` is never set), the empty-notebook no-op, the page manifest, jslink lifting, and
  idempotent `writeFileIfChanged` (stable mtimes across runs).
- **Build artifact:** `npm run build` emits `dist/plugin.mjs`; confirm `RUNTIME_SOURCE` is inlined
  (grep the bundle for a known runtime symbol like `initializeStaticWidget`).
- **Real MyST build:** `nox -s docs` → `docs/_build/html` exists; open it (or
  `nox -s docs-live`) and confirm the demo widget renders **with no kernel** and is interactive.
  This is the true end-to-end check — it exercises transform → asset emission →
  `@myst-theme/anywidget` render. Per project guidance, run this whole-stack browser load first;
  only drill into intermediate `_widget_assets/` artifacts if it fails.
- **Typecheck:** `npm run typecheck` clean (runtime DOM types + transform node types).
- **Release dry-run (manual, do not auto-trigger):** confirm `release.yml` would attach
  `dist/plugin.mjs`; verify the README's `releases/latest/download/plugin.mjs` URL pattern.

> Note: per standing guidance, **do not perform GitHub write actions** (no `gh` release, no
> `git push`) as part of execution — set up the workflows and hand the release step to the user.

---

## Out of scope / leave behind
- The source `anywidget-experiments` repo is **not modified**. No npm publishing. No lonboard /
  geopandas / terra-ui demos in the new repo's docs (the upstream write-ups are copied as
  reference markdown only, not as runnable showcases).
