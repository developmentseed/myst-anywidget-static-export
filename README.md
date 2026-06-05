**Note**: This plugin is extracted out from initial experiments with this idea in [batpad/anywidget-experiments](https://github.com/batpad/anywidget-experiments). To read a human-written note about the background of the project and the motivation, please see [here](https://batpad.github.io/anywidget-experiments/what-is-this/).

This repository is made with heavy AI-assistance. The idea is to provide a MyST plugin that will render anywidget-based widgets in Python notebooks in its static exports.

# myst-anywidget-static-export

A [MyST](https://mystmd.org) plugin that renders [anywidget](https://anywidget.dev)
notebook outputs as **static, kernel-free interactive widgets**.

**🔗 [Live demo](https://developmentseed.org/myst-anywidget-static-export/)** — a
counter widget rendered in static HTML, interactive with no Jupyter kernel.

When MyST builds your site, this plugin reads each executed notebook's embedded
widget state, writes the widget's ESM/CSS and a small browser host runtime to disk,
and rewrites the output AST node so the `@myst-theme/anywidget` renderer can mount
it client-side — with no running Jupyter kernel. It handles the hard cases too:
binary buffers, transitively-referenced sub-models, cross-widget interop, and
`jslink`/`jsdlink` bindings.

This repo extracts and hardens the plugin first proven in
[`developmentseed/anywidget-experiments`](https://github.com/developmentseed/anywidget-experiments),
which remains the home of the deeper experiments and provenance.

## Usage

Reference the released plugin asset from your project `myst.yml`:

```yaml
version: 1
project:
  plugins:
    - https://github.com/developmentseed/myst-anywidget-static-export/releases/latest/download/plugin.mjs
```

Execute your notebook (so anywidget embeds its widget state into the notebook
metadata), then build your site as usual. Any cell whose output is an anywidget
view is rendered statically. See the [live demo](https://developmentseed.org/myst-anywidget-static-export/)
and [`docs/`](./docs) for a minimal working example.

## How it works

- A single `project`-stage **transform** walks the AST for `output` nodes carrying
  `application/vnd.jupyter.widget-view+json` and rewrites them to `anywidget` nodes.
- Widget ESM/CSS, model state, and a shared **host runtime** are emitted as sidecar
  files under `_widget_assets/` next to each notebook.
- The host runtime hydrates base64 buffers into `DataView`s, proxies sub-models,
  injects CSS into the shadow root, and exposes a scoped cross-widget registry
  (`host.getModel` / `host.waitForModel`).

The load-bearing workarounds are documented in
[`docs/design-notes.md`](./docs/design-notes.md) (the "9 hacks"). Detailed
upstream-bug write-ups live in the origin repo
[`developmentseed/anywidget-experiments`](https://github.com/developmentseed/anywidget-experiments/tree/main/docs).
The original design plan is archived at
[`docs/split-anywidget-static-export-plan.md`](./docs/split-anywidget-static-export-plan.md).

## Development

Requires Node 22, plus [`uv`](https://docs.astral.sh/uv/) for the docs/CI sessions.

```bash
npm install
npm test            # builds the plugin, then runs the vitest suite
npm run build       # two-pass esbuild → dist/plugin.mjs
npm run typecheck   # tsc --noEmit

nox -s test         # build + test, as CI runs it
nox -s docs-live    # serve the demo MyST site with live reload
nox -s docs         # static HTML build → docs/_build/html
```

The plugin source is TypeScript under `src/`. The browser host runtime
(`src/runtime/`) is bundled to a string at build time and embedded into the
node-side transform (`src/transform/`); see [`CLAUDE.md`](./CLAUDE.md) for the
architecture and the build gotcha.

## Releasing

See [`RELEASE.md`](./RELEASE.md). Publishing a GitHub Release builds `dist/plugin.mjs`
and attaches it as an asset that users pin by URL. There is no npm package.

## License

MIT
