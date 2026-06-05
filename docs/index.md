---
title: myst-anywidget-static-export
---

# Static anywidgets in MyST

This MyST plugin rewrites [anywidget](https://anywidget.dev) outputs in executed
notebooks into **static, kernel-free interactive widgets**. When MyST builds your
site, the plugin reads each notebook's embedded widget state, writes the widget's
ESM/CSS and a small host runtime to disk, and rewrites the output node so the
[`@myst-theme/anywidget`](https://mystmd.org) renderer can mount it in the browser
— no running Jupyter kernel required.

It handles the hard cases too: binary buffers, transitively-referenced sub-models,
cross-widget interop, and `jslink`/`jsdlink` bindings. See
[the design notes](https://github.com/developmentseed/myst-anywidget-static-export/blob/main/docs/design-notes.md)
for the load-bearing workarounds, and the
[anywidget-experiments](https://github.com/developmentseed/anywidget-experiments)
repo for the origin of the experiment.

## Usage

Reference the released plugin asset from your project `myst.yml`:

```yaml
version: 1
project:
  plugins:
    - https://github.com/developmentseed/myst-anywidget-static-export/releases/latest/download/plugin.mjs
```

Then execute your notebook (so anywidget embeds its state into the notebook
metadata) and build your site. Any cell whose output is an anywidget view is
rendered statically.

## Live demo

The [counter demo](./counter-demo.ipynb) is a tiny, already-executed notebook
containing a counter widget. The buttons work in the built HTML with no kernel
attached — try them.
