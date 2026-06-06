# CLAUDE.md

Guidance for agents working in this repo.

## What this repo is

A standalone [MyST](https://mystmd.org) plugin that renders [anywidget](https://anywidget.dev)
notebook outputs as static, kernel-free interactive widgets. It was extracted from
[`developmentseed/anywidget-experiments`](https://github.com/developmentseed/anywidget-experiments)
(the frozen origin — do **not** modify that repo). The single deliverable is
`dist/plugin.mjs`, distributed as a **GitHub Release asset** (no npm publish).

Background reading: `docs/design-notes.md` (the "9 hacks" — the load-bearing
browser-side workarounds) and `docs/split-anywidget-static-export-plan.md` (the
original extraction plan). Detailed upstream-bug write-ups live in the origin
`anywidget-experiments` repo's `docs/`.

## Architecture

- `src/plugin.ts` — the default export `{ name, transforms: [...] }`. One
  `project`-stage transform; no directives or roles.
- `src/transform/` — **node-side**. Walks the MyST AST, reads notebook widget
  state, emits sidecar assets under `_widget_assets/`, rewrites `output` nodes to
  `anywidget` nodes. `walk.ts` (AST traversal), `widget-state.ts` (pure helpers),
  `emit.ts` (I/O + manifest + wrapper), `rewrite.ts` (node mutation).
- `src/runtime/` — **browser-side**. The host runtime mounted in the page:
  base64→DataView buffers (`buffers.ts`), an event bus (`emitter.ts`), sub-model
  proxies (`submodel.ts`), shadow-DOM CSS injection (`css.ts`), and the scoped
  cross-widget registry + model setup (`registry.ts`). `index.ts` exports
  `initializeStaticWidget` / `renderStaticWidget`.
- `src/types.ts`, `src/constants.ts` — local typings and constants. No MyST runtime
  imports; the package has **zero non-dev dependencies**. Prefer local typings over
  adding deps.

## The build gotcha (read this before changing the runtime)

The transform needs the runtime as a **string** (it writes it to disk and prepends
it into each per-widget wrapper), but we author it as type-checked TypeScript.
`scripts/build.mjs` is a **two-pass** build:

1. esbuild bundles `src/runtime/index.ts` (browser target) to a string.
2. It writes `src/generated/runtime-source.ts` exporting that string as `RUNTIME_SOURCE`.
3. esbuild bundles `src/plugin.ts` (which imports the generated module) → `dist/plugin.mjs`.

Rules:
- **Never edit `src/generated/runtime-source.ts`** — it is derived and gitignored.
  Edit the runtime in `src/runtime/*.ts`.
- Always `npm run build` before `npm run typecheck` or `npm test` — `src/plugin.ts`
  imports the generated module, so it must exist. `npm test` runs the build first.
- The runtime needs **DOM** lib types; the transform is **node**-only. `tsconfig.json`
  enables both libs globally.

## Conventions worth preserving

- Do **not** set `node.css` in the rewrite. CSS is inlined onto the model
  (`_myst_css_text`) and injected into the shadow root by the runtime — a `<link>`
  inside the render target gets wiped by React's `createRoot` (e.g. lonboard).
- Asset filenames are content-hashed and written via `writeFileIfChanged`, so
  rebuilds are idempotent (stable mtimes). A test asserts this — keep it true.
- The widget-state contract: read from
  `notebook.metadata.widgets["application/vnd.jupyter.widget-state+json"].state`.

## How to work

```bash
npm test            # build + 9 vitest behavior cases (tests/transform.test.ts)
npm run typecheck   # tsc --noEmit
nox -s docs-live    # the real MyST demo site, live reload
nox -s docs         # static HTML → docs/_build/html
nox -s gen-demos    # regenerate demo notebooks' committed widget state
```

Demo notebooks (`docs/*-demo.ipynb`) carry their widget state in
`metadata.widgets` because the docs build does **not** run a kernel. That state is
generated from the widget source in `docs/widgets/` by `docs/generate_demos.py`
(deterministic — random model UUIDs are remapped to stable slugs, so re-running is
a git no-op when widgets are unchanged). `nox -s docs` / `docs-live` regenerate it
automatically; run `nox -s gen-demos` after editing a demo widget. Widget dep
versions are pinned in `noxfile.py` (`WIDGET_DEPS`) for reproducibility.

The behavior tests cover the input→output contract (node rewrite, VBox unwrap,
buffers, submodels, CSS inlining, no-op, manifest, jslink, idempotency) and
deliberately avoid asserting on hashes or runtime internals — refactor freely as
long as they stay green.

The true end-to-end check is loading the built docs site (`nox -s docs` then serve
`docs/_build/html`, or `nox -s docs-live`) and confirming the counter renders and
its buttons work **with no kernel**. Only drill into `_widget_assets/` artifacts if
that fails.

## Guardrails

- Do not modify the source `anywidget-experiments` repo.
- Do not `git push` or cut a GitHub Release unless explicitly asked — releases are
  user-triggered (see `RELEASE.md`).
- Use Node 22.
