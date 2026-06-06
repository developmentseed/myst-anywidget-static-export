# `anywidget-static-export.mjs` — what's actually happening here

> Ported verbatim from the origin repo
> [`developmentseed/anywidget-experiments`](https://github.com/developmentseed/anywidget-experiments).
> File references below (e.g. `src/runtime/…` paths, `docs/upstream-*.md`) point at
> that repo's layout; the detailed upstream-bug write-ups it mentions live there.

This is a `mystmd` AST-transform plugin that makes notebook-cell anywidget outputs
render in MyST's static HTML build. The default `myst-theme` pipeline strips
widgets and shows a kernel-required "Loading…" placeholder; this plugin rewrites
those output nodes into `anywidget`-typed nodes the `@myst-theme/anywidget`
renderer already knows how to mount, with extra pieces bolted on for binary
buffers and cross-widget references.

The high-level shape is roughly fine. The implementation, however, is held
together by a stack of workarounds against quirks in three different upstreams
(mystmd, myst-theme, `@jupyter-widgets/base`) plus one quirk of how lonboard
ships its frontend. Each of those workarounds is documented below so the
next person reading this can tell which lines are load-bearing and which are
incidental.

If you only want a five-second summary: notebook outputs go in → `anywidget`
AST nodes come out, with `_esm` source wrapped by a small shim that patches
broken `MystAnyModel` methods, hydrates Parquet/binary buffers from base64 into
`DataView`s, and stubs `widget_manager.get_model` against an embedded sub-model
graph. That's it. Everything else is the cost of getting that to work in
practice.

---

## How this fits into the build

```
notebook (.ipynb)
   │   contains executed widget state with binary buffers
   │   only if you ran nbclient (see prebuild script in package.json);
   │   JLab "Save Widget State" silently strips buffers — see
   │   docs/upstream-widget-buffer-serialization.md.
   ▼
mystmd reads the notebook, builds an AST, runs project-stage plugins
   │
   ▼
plugins/anywidget-static-export.mjs   ← us
   │   For each cell-output node carrying widget-view+json:
   │     1. Resolve the model_id, walking into VBox/HBox containers if needed.
   │     2. Read the source notebook's metadata.widgets and pull
   │        the root widget + every transitively-referenced sub-model.
   │     3. Wrap the widget's _esm with the shim (see below).
   │     4. Mutate the AST node into {type:'anywidget', esm, model, ...}.
   │   The runtime shim lives inside the wrapped _esm string.
   ▼
mystmd's transformWidgetStaticAssetsToDisk copies referenced ESM files into
_build/html/build/<hash>-<hash>.mjs and rewrites node.esm to that URL.
   │   We do NOT use this for CSS — see hack #5.
   ▼
@myst-theme/anywidget renders <AnyWidgetRenderer> in the browser:
attaches a shadow DOM, dynamically imports node.esm, calls
initialize/render({model, el}). Our shim intercepts both.
```

`npm run prebuild` (in `package.json`) runs `jupyter nbconvert --execute --inplace`
on the lonboard demo notebook. This is required because mystmd's own executor
drops widget comm messages — see `docs/upstream-mystmd-comm-capture.md`.

---

## The hacks, indexed

| # | What                                              | Why                                                                 | Upstream-able? |
|---|---------------------------------------------------|---------------------------------------------------------------------|----------------|
| 1 | Walk into VBox/HBox to find anywidget descendant  | Lonboard's `Map` displays as a VBox; cell output points to the VBox | Probably myst-theme could surface this              |
| 2 | Bundle `_myst_submodels` recursively              | Lonboard `Map` references its layers via `IPY_MODEL_<id>`           | No — needed by widget protocol                      |
| 3 | Inline buffers as base64 + JS port of `put_buffers` | `metadata.widgets` is JSON-only; binary lives in a parallel `buffers` array | Mostly upstream-able  |
| 4 | `Object.defineProperty` to install `widget_manager` | `MystAnyModel` exposes `widget_manager` as a getter-only prop that throws | Yes, see below                                |
| 5 | Inline CSS as `<style>` in shadow root, not `<link>` in `el` | React `createRoot()` wipes children; `<link>` injected by renderer dies | Yes, see below                                |
| 6 | No-op `model.off`, `model.send`, `model.save_changes` | `MystAnyModel` stubs them all to throw "not implemented yet"          | Yes — small upstream PR                            |
| 7 | Standalone wrapper module around untouched widget ESM | The static host must intercept `initialize`/`render` without rewriting user code | Yes — belongs in the asset pipeline               |
| 8 | Filter underscore + `IPY_MODEL_*` traits when building `node.model` | Avoid leaking widget-internal state into the renderer-visible model | No                                                |
| 9 | Pre-execute notebook with nbclient to capture buffers | mystmd's executor drops comm messages                              | Yes — see docs/upstream-mystmd-comm-capture.md     |

Pick one number, ctrl-F it below.

---

### Hack #1 — VBox/HBox container unwrap

**File**: `findAnywidgetDescendant` in `anywidget-static-export.mjs`.

When you do `m  # display the map` in a notebook cell, lonboard's `Map`
doesn't display as itself — its `_repr_mimebundle_` (or rather, ipywidgets'
default display logic) wraps it in a `VBoxModel` whose `children` includes the
Map and a status footer. The cell-output's `widget-view+json` therefore points
to the VBox's `model_id`, not the Map's. The VBox is `@jupyter-widgets/controls`
not `anywidget`, and has no `_esm` of its own — nothing to mount.

We walk `state.children` recursively until we find a model whose `model_module === "anywidget"`,
emit the `anywidget` node for *that*, and lose any sibling children (status
footers, controls). Acceptable for now; not generally correct.

**Better long-term**: `@myst-theme/anywidget` could expose a hook for a
container renderer that mounts each anywidget child individually.

### Hack #2 — Sub-model bundling

**File**: `buildSubModels` + `node.model._myst_submodels` in `anywidget-static-export.mjs`.

Lonboard's Map's frontend code does `await widget_manager.get_model(layerId)`
to pull each layer's model — that's how the widget protocol works.
Layer widgets are separate models (`@jupyter-widgets/base`, not anywidget) with
their own state and their own buffers. So in addition to the root widget's
state, we have to ship every transitively-referenced sub-model too.

`buildSubModels(rootId, widgetState)` BFS-walks `IPY_MODEL_<id>` strings (any
that appear in the root's state or any transitive sub-model's state) and
returns a flat `{id: {state, buffers, model_module, model_name}}` map. We stash
that under `node.model._myst_submodels`. The runtime shim's
`widget_manager.get_model(id)` then returns `Promise<SubModelProxy>` from this
bundle.

**Page weight**: For our demo, six sub-models came along: layers, basemap,
NavigationControl, ScaleControl, FullscreenControl, layout. The bundling is
recursive — if a layer references another widget, that gets pulled in too.
Watch this if pages get heavy.

### Hack #3 — Buffer hydration via base64 + `put_buffers` port

**File**: `__mystApplyBuffers` / `__mystPutBuffers` / `__mystBase64ToArrayBuffer` in `anywidget-static-export.mjs` (the SHIM_HEADER).

The widget protocol stores binary data (lonboard ships Apache Parquet bytes per
record-batch via the `table` trait) out-of-band. In `metadata.widgets`, this
becomes `state.table = [null]` plus a sibling `buffers: [{path: ['table', 0], data: '<base64>', encoding: 'base64'}]`.
The browser-side widget runtime is supposed to splice `DataView`s back into
state at the `path` locations before `render()` runs.

We port `put_buffers` (~20 LOC) from `@jupyter-widgets/base/src/utils.ts`.
The implementation is straightforward; the *reason it's needed at all* is the
real story — see `docs/upstream-widget-buffer-serialization.md`.

This runs in two places: in `__mystSetupModel` for the root widget (mutating
through `model.set` because we don't have direct access to `MystAnyModel`'s
internal `_state`), and in `__MystSubModel`'s constructor for sub-models (deep
clone + in-place splice).

### Hack #4 — Object.defineProperty for `widget_manager`

**File**: `__mystSetupModel` in `anywidget-static-export.mjs`.

```js
Object.defineProperty(model, 'widget_manager', {
  configurable: true,
  writable: true,
  value: wm,
});
```

`MystAnyModel` (the runtime model class in `@myst-theme/anywidget`) defines
`widget_manager` as a **getter-only** property on the prototype:

```js
get widget_manager(){throw new Error("MystAnyModel.widget_manager does not exist.")}
```

A plain `model.widget_manager = wm` is silently ignored (no setter; non-strict
mode). The fix is to install a **data property on the instance** that shadows
the prototype getter via `defineProperty`. We spent ~30 minutes on this one
specifically because the assignment looked like it should work.

**Upstream fix**: change the prototype to allow a setter, or have
`MystAnyModel`'s constructor accept a `widgetManager` option.

### Hack #5 — CSS injected as `<style>` into shadow root, not `<link>` into `el`

**File**: `__mystEnsureShadowCss` + `node.model._myst_css_text` in `anywidget-static-export.mjs`.

The longest detective story in the file. Documented in detail in
`docs/lonboard-shadow-dom-height.md`. TL;DR:

- `@myst-theme/anywidget` renderer appends a `<link rel="stylesheet">` *into the
  user's render-target div `R`*, then calls `user.render({model, el: R})`.
- Lonboard's render uses React `createRoot(R).render(...)`, which wipes `R`'s
  children. The link goes with them.
- Tailwind utility classes (`.h-full`, `.w-full`, `.flex`) baked into lonboard's
  HTML now don't apply. Deck.gl's container can't compute its height correctly
  and grows unboundedly to ~234,000 pixels.

We bypass the renderer's CSS injection entirely (deliberately don't set
`node.css`), inline the CSS text into `node.model._myst_css_text` at plugin
time, and have the shim attach a `<style>` element to the **shadow root**
(sibling of `R`) where React can't reach it.

The CSS lands in the page JSON as a string. For lonboard that's ~330 KB per
map, which is fine for a demo; revisit if pages get plural in lonboard maps.

**Upstream fix**: the renderer should append CSS to the shadow root, not into
the user's render target. Or use Constructable Stylesheets via
`shadowRoot.adoptedStyleSheets`.

### Hack #6 — Stub broken MystAnyModel methods

**File**: `__mystSetupModel` in `anywidget-static-export.mjs`.

`MystAnyModel` stubs three methods to throw `"not implemented yet"`:
- `off(name, fn)` — event unsubscribe
- `save_changes()` — push state to kernel
- `send(content, callbacks, buffers)` — send a comm message

In a kernelless static page, these are all no-ops. We assign `model.off = () => {}`
etc. directly — these are regular methods on the prototype (data properties),
so plain assignment shadows them on the instance. Only `widget_manager` needs
`defineProperty` because it's a getter (hack #4).

**Upstream fix**: implement these as no-ops, or at least don't throw — let
widgets that call them work in static contexts. ~5 lines of TypeScript.

### Hack #7 — Wrapper module around untouched widget ESM

**File**: `buildWrapperModule` in `anywidget-static-export.mjs`.

The static host must intercept `initialize`/`render`, but it should not edit the
widget author's JavaScript. Earlier versions tried to capture `export default`
with regexes and then append our own default export. That broke down quickly:
hand-written widgets and bundled lonboard modules use different export shapes.

The current version writes the original `_esm` to a `.source.mjs` sidecar and
generates a separate `.wrapper.mjs`. The wrapper imports the original module,
normalizes its default export, and then delegates through the static host:

```js
export default {
  initialize(args) {
    return initializeStaticWidget(userModule, args);
  },
  render(args) {
    return renderStaticWidget(userModule, args);
  },
};
```

In this prototype the wrapper embeds the source in a Blob URL because MyST only
copies the `node.esm` file it sees in the AST. A cleaner upstream version should
register both the wrapper and source module as first-class build assets and use
normal relative ESM imports.

### Hack #8 — `_`-prefix and `IPY_MODEL_*` filtering in `buildInitialModel`

**File**: `buildInitialModel` in `anywidget-static-export.mjs`.

We strip keys starting with `_` (so `_esm`, `_css`, `_anywidget_id`, `_model_module`, etc. don't pollute `model.get(...)`) but **keep** `IPY_MODEL_<id>` strings in their original positions. The frontend's `unpack_models`
(or `widget_manager.get_model` calls) handles unwrapping.

Boring but worth being aware of: there's at least one trait per widget where
the name doesn't start with underscore but the value is `IPY_MODEL_<id>` (e.g.
`Map.layers`, `Map.basemap`, `Map.layout`). We pass these through as-is.

### Hack #9 — nbclient pre-execute (the prebuild script)

`package.json` runs `jupyter nbconvert --to notebook --execute --inplace
notebooks/06_lonboard_static.ipynb` before `myst build`.

Why it's necessary: mystmd's own executor (`packages/myst-execute/src/kernel.ts`)
silently drops every comm message, so even with `project.execute: true` the
build captures **zero** widget state. Worse, JupyterLab's "Save Widget State
Automatically" only captures non-buffer state due to a deeper upstream bug
(see `docs/upstream-widget-buffer-serialization.md`). nbclient is the one path
that captures comm messages losslessly because it snoops at the wire-protocol
level.

**Upstream fix**: detailed in `docs/upstream-mystmd-comm-capture.md`.

---

## Adding support for a new widget that breaks

A rough debugging order:

1. Build, open the page, look at the console. Note any `MystAnyModel.X not implemented yet` — that tells you which method to no-op in `__mystSetupModel`.
2. If the wrapper never runs, inspect the emitted `.wrapper.mjs` and confirm the page JSON points at it.
3. If the widget renders but is wrong size / styles missing, it's probably a CSS-not-applied-in-shadow-DOM issue (hack #5).
4. If `widget_manager.get_model(id)` is called with an id you don't have in `_myst_submodels`, the BFS in `buildSubModels` missed a reference path (e.g. the widget references something through a non-`children` field whose name we don't recognize).
5. If `model.X is undefined`, our `__MystSubModel` is missing a method or property — add it.

Use the chrome-devtools MCP to introspect React fiber + shadow DOM directly.
Notes from when we did this:
- Widget content is rendered into a shadow DOM under `.myst-anywidget`. Most queries need `host.shadowRoot.querySelector(...)`.
- Lonboard exposes its deck instance via `window.__deck` but only at first mount; useless for current state.
- Walking the React fiber tree finds custom hook state. `Object.keys(el).find(k => k.startsWith('__reactFiber'))` gives the fiber key.

## Cross-widget interop — resolution keys

When one widget looks up another through the host, *which key you use depends on
whether you're resolving a root widget or a sub-model.* They are keyed
differently (see `keysForState` in `src/runtime/refs.ts`):

- **Root widgets** (top-level cell outputs) are keyed by `widget_id` (user-set),
  the model UUID, and `_anywidget_id` (the Python class path, e.g.
  `lonboard._map.Map`). Their `model_id` field is **unset**.
- **Sub-models** (e.g. lonboard layers pulled in via `widget_manager.get_model`)
  carry a `model_id`, and a single id can map to several proxies.

So:

- To resolve a **root** widget, use `host.getModel(ref)` / `host.waitForModel(ref)`
  with a `widget_id` / UUID / `_anywidget_id`. Do **not** match on `model_id` — it
  is empty for roots, so the lookup silently finds nothing.
- Use `registry.filter(m => m.model_id === id)` only to fan out over **sub-model**
  proxies.

`manywidgets`' `resolveModel` (`packages/core/src/index.ts`) does both and is a
good worked example.

### Container children (`host.renderChild`)

A container anywidget can render other anywidgets inside its own DOM, kernel-free,
via `host.renderChild(ref, el): Promise<dispose>`. The child's `_esm`/`_css`
already ride along in `_myst_submodels` (the transform bundles every
transitively-referenced anywidget), so no extra assets are emitted: `renderChild`
resolves the already-registered child `SubModel`, imports its `_esm`, injects its
CSS into the current shadow root, runs the child's `initialize?`/`render`, and
returns the child's cleanup. It is reentrant, so nested containers work. By
convention a container declares its child-ref traits with a synced
`_myst_child_traits` list and its JS iterates those traits, calling `renderChild`
per ref. (A future optimization could extract per-child wrapper modules as
cacheable assets; today child ESM rides inline in the page state, as all
sub-models do.)

## Known limitations

- Cross-widget interop now goes through the per-page host (`host.getModel`,
  `host.waitForModel`, `host.getWidget`, and scoped `host.on/off/emit`). The
  scoped registry still lives behind the host runtime, but widgets should not
  read or write global registries directly.
- The current event boundary is intentionally small: the host emits lifecycle
  events such as `model:registered`, while widget-to-widget data flow still uses
  model change events (`model.on("change:x", ...)`). This is enough for the
  examples, but not a full AFM/event design.
- No widgets with complex serializers (custom `to_json` on the Python side that
  we'd need to mirror in JS) have been tested.
- The CSS injection is unconditional — every anywidget that ships a `_css`
  gets a `<style>` element in its shadow root. For widgets where the renderer's
  default `<link>` would have worked fine (e.g. CounterWidget), this is mildly
  redundant.
- `package.json`'s `prebuild` script only re-executes `06_lonboard_static.ipynb`
  right now. Generalize the glob (or remove the scoping) when adding more
  buffer-bearing notebooks.

## See also

- `docs/upstream-mystmd-comm-capture.md` — the prebuild step we want to delete
- `docs/upstream-widget-buffer-serialization.md` — deeper upstream bug under #3 / #9
- `docs/lonboard-shadow-dom-height.md` — the long form of hack #5
