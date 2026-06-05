// Rewrites notebook `output` nodes that carry application/vnd.jupyter.widget-view+json
// into `anywidget` AST nodes that the @myst-theme/anywidget renderer can render
// without a Jupyter kernel.
//
// Phase 1 (counter widgets): rewrite the cell-output's widget-view to an anywidget
//   node, write the user's _esm/_css to disk, and shim model.save_changes so
//   kernelless interaction doesn't throw.
//
// Phase 2 (binary-buffer widgets like lonboard): when the cell-output's widget-view
//   points at a non-anywidget container (VBox/HBox), walk into children to find the
//   anywidget descendant. Bundle every transitively-referenced sub-model alongside
//   its buffers; the wrapper's port-of-put_buffers reconstructs DataViews at runtime,
//   and a stub model.widget_manager.get_model(id) returns sub-model proxies on demand.

import fs from "node:fs";
import path from "node:path";

import { WIDGET_STATE_MIME, WIDGET_VIEW_MIME } from "./constants.js";
import {
  emitStaticWidgetAssets,
  ensureStaticAssetDir,
  shortHash,
  writeManifest,
  type ManifestEntry,
} from "./transform/emit.js";
import { rewriteOutputNodeToAnywidget, suppressJslinkReprs } from "./transform/rewrite.js";
import { findOutputsWithParent, parseViewMime } from "./transform/walk.js";
import {
  buildInitialModel,
  collectJsLinks,
  findAnywidgetDescendant,
} from "./transform/widget-state.js";
import type { MystNode, MystPlugin, VFile, WidgetState } from "./types.js";

const transformPlugin = () => async (tree: MystNode, file: VFile): Promise<void> => {
  const sourcePath = file?.path ?? file?.history?.[0];
  if (!sourcePath || !sourcePath.endsWith(".ipynb")) return;
  if (!fs.existsSync(sourcePath)) return;

  let notebook: any;
  try {
    notebook = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  } catch {
    return;
  }

  const widgetState: WidgetState | undefined =
    notebook?.metadata?.widgets?.[WIDGET_STATE_MIME]?.state;
  if (!widgetState) return;

  const assetDir = ensureStaticAssetDir(sourcePath);
  const links = collectJsLinks(widgetState);

  let rewriteCount = 0;
  const manifestEntries: ManifestEntry[] = [];
  for (const { node } of findOutputsWithParent(tree)) {
    const data = node?.jupyter_data?.data;
    const viewMime = data?.[WIDGET_VIEW_MIME];
    if (!viewMime) continue;

    const view = parseViewMime(viewMime);
    const cellViewModelId = view?.model_id;
    if (!cellViewModelId) continue;

    // Phase 2: if the cell output points at a container (VBox/HBox), walk into
    // children for the first anywidget descendant. Phase 1 widgets resolve to themselves.
    const rootId = findAnywidgetDescendant(cellViewModelId, widgetState);
    if (!rootId) continue;

    const entry = widgetState[rootId];
    const state = entry.state || {};
    const esm = (state as any)._esm;
    const css = (state as any)._css;
    if (!esm) continue;

    const model = buildInitialModel(rootId, widgetState, links);
    if (css) {
      model._myst_css_text = css;
      model._myst_css_key = shortHash(css);
    }

    const assets = emitStaticWidgetAssets(assetDir, esm, css, model);
    rewriteOutputNodeToAnywidget(node, rootId, model, assets);

    manifestEntries.push({
      id: rootId,
      ...assets,
      buffers: model._myst_buffers?.length ?? 0,
      submodels: Object.keys(model._myst_submodels ?? {}).length,
    });
    rewriteCount += 1;
  }

  // jslink lifting: the page-level manifest is attached to each rewritten widget
  // model under `_myst_links`; the shared host registry installs the bindings once
  // and resolves source/target models as they register.
  if (links.length > 0) {
    suppressJslinkReprs(tree);
  }

  if (rewriteCount > 0) {
    writeManifest(assetDir, sourcePath, manifestEntries, links);
    const linkSummary = links.length > 0 ? `, ${links.length} jslink(s)` : "";
    console.log(
      `[anywidget-static-export] exported ${rewriteCount} widget(s)${linkSummary} in ${path.basename(sourcePath)}`,
    );
  }
};

const plugin: MystPlugin = {
  name: "anywidget-static-export",
  transforms: [
    {
      name: "anywidget-from-notebook-outputs",
      stage: "project",
      plugin: transformPlugin,
    },
  ],
};

export default plugin;
