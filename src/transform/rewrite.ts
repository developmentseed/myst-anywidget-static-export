// AST node rewriting: turn an output node into an `anywidget` node, and suppress
// the leftover text repr that jslink/jsdlink-only cells emit.

import { nanoidLike } from "./emit.js";
import { findOutputsWithParent } from "./walk.js";
import type { EmittedAssets, InitialModel, MystNode } from "../types.js";

// Splice text/plain outputs whose only content is the `Link(source=..., target=...)`
// repr that ipywidgets prints when a jslink/jsdlink cell is the last expression.
// The host registry renders the binding; the repr would otherwise leak through as
// plain-text page noise (or, if blanked, as a "Cannot render output node" disclosure).
export function suppressJslinkReprs(tree: MystNode): void {
  const reprPattern =
    /^(?:Link|DirectionalLink)\(source=\(.+,\s*'[^']+'\),\s*target=\(.+,\s*'[^']+'\)\)\s*$/;
  for (const { node, parent } of findOutputsWithParent(tree)) {
    if (node.type !== "output") continue;
    const data = node?.jupyter_data?.data;
    if (!data) continue;
    const keys = Object.keys(data);
    // Only act when text/plain is the sole representation — never silently drop a
    // widget-view+json or richer mime type.
    if (keys.length !== 1 || keys[0] !== "text/plain") continue;
    const raw: any = data["text/plain"];
    const text =
      Array.isArray(raw?.content)
        ? raw.content.join("")
        : typeof raw?.content === "string"
          ? raw.content
          : Array.isArray(raw)
            ? raw.join("")
            : typeof raw === "string"
              ? raw
              : "";
    if (!reprPattern.test(text.trim())) continue;
    if (parent && Array.isArray(parent.children)) {
      const idx = parent.children.indexOf(node);
      if (idx >= 0) parent.children.splice(idx, 1);
    }
  }
}

// Rewrite a MyST AST output node into an anywidget node. Asset emission is kept
// separate so this can become an upstream MyST/JupyterBook transform later.
export function rewriteOutputNodeToAnywidget(
  node: MystNode,
  rootId: string,
  model: InitialModel,
  assets: EmittedAssets,
): void {
  delete node.jupyter_data;
  node.type = "anywidget";
  node.esm = assets.module;
  // We intentionally do NOT set node.css here. The renderer would inject it via a
  // <link> inside the user's render-target div, which React's createRoot wipes for
  // widgets like lonboard. Instead we inline the CSS text on the model and the
  // runtime shim attaches a <style> element directly to the shadow root.
  node.model = model;
  node.id = rootId;
  node.children = [];
  if (!node.key) node.key = nanoidLike();
}
