// Pure-logic helpers that read the notebook's widget-state map. No I/O.

import { IPY_MODEL_PREFIX } from "../constants.js";
import type {
  InitialModel,
  JsLink,
  SubModelBundle,
  WidgetState,
} from "../types.js";

// Returns the list of model_ids reachable via IPY_MODEL_<id> strings, walking
// nested arrays/objects.
export function collectIpyRefs(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.startsWith(IPY_MODEL_PREFIX)) out.push(value.slice(IPY_MODEL_PREFIX.length));
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectIpyRefs(v, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectIpyRefs(v, out);
    return out;
  }
  return out;
}

// Walk children of a container (jupyter-widgets/controls VBox/HBox) to find the
// first descendant whose state has `_anywidget_id`. Returns its model_id, or null.
export function findAnywidgetDescendant(
  modelId: string,
  widgetState: WidgetState,
  visited: Set<string> = new Set(),
): string | null {
  if (visited.has(modelId)) return null;
  visited.add(modelId);
  const entry = widgetState[modelId];
  if (!entry) return null;
  if (entry.model_module === "anywidget") return modelId;
  const children = (entry.state as any)?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child === "string" && child.startsWith(IPY_MODEL_PREFIX)) {
        const found = findAnywidgetDescendant(
          child.slice(IPY_MODEL_PREFIX.length),
          widgetState,
          visited,
        );
        if (found) return found;
      }
    }
  }
  return null;
}

// Scan top-level state for LinkModel/DirectionalLinkModel entries produced by
// widgets.jslink / widgets.jsdlink. These are siblings of the cell-output roots,
// so buildSubModels' BFS never finds them; we surface them here so the plugin
// can synthesize a client-side binding without a connector widget.
export function collectJsLinks(widgetState: WidgetState): JsLink[] {
  const out: JsLink[] = [];
  for (const [id, entry] of Object.entries(widgetState)) {
    const name = entry?.model_name;
    if (name !== "LinkModel" && name !== "DirectionalLinkModel") continue;
    const src = (entry.state as any)?.source;
    const tgt = (entry.state as any)?.target;
    if (!Array.isArray(src) || src.length !== 2) continue;
    if (!Array.isArray(tgt) || tgt.length !== 2) continue;
    const [sourceRef, sourceAttr] = src;
    const [targetRef, targetAttr] = tgt;
    if (typeof sourceRef !== "string" || !sourceRef.startsWith(IPY_MODEL_PREFIX)) continue;
    if (typeof targetRef !== "string" || !targetRef.startsWith(IPY_MODEL_PREFIX)) continue;
    out.push({
      id,
      bidirectional: name === "LinkModel",
      sourceId: sourceRef.slice(IPY_MODEL_PREFIX.length),
      sourceAttr,
      targetId: targetRef.slice(IPY_MODEL_PREFIX.length),
      targetAttr,
    });
  }
  return out;
}

// Build a flat sub-model bundle: every widget reachable transitively from rootId
// via IPY_MODEL_<id> strings. rootId itself is NOT included (its state lives in
// node.model).
export function buildSubModels(rootId: string, widgetState: WidgetState): SubModelBundle {
  const out: SubModelBundle = {};
  const queue = [...collectIpyRefs(widgetState[rootId]?.state)];
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = widgetState[id];
    if (!entry) continue;
    out[id] = {
      state: entry.state ?? {},
      buffers: entry.buffers ?? [],
      model_module: entry.model_module,
      model_name: entry.model_name,
    };
    queue.push(...collectIpyRefs(entry.state));
  }
  return out;
}

// Build the AST `node.model` payload: the root widget's user state, plus our
// private _myst_* keys for the runtime shim to consume.
export function buildInitialModel(
  rootId: string,
  widgetState: WidgetState,
  links: JsLink[] = [],
): InitialModel {
  const rootEntry = widgetState[rootId];
  if (!rootEntry) return {};
  const state = rootEntry.state || {};
  const model: InitialModel = {};
  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith("_")) continue; // skip _esm, _css, _model_module, etc.
    model[key] = value; // keep IPY_MODEL_<id> strings for unpack_models
  }
  model._myst_buffers = rootEntry.buffers ?? [];
  model._myst_submodels = buildSubModels(rootId, widgetState);
  if (links.length > 0) model._myst_links = links;
  // Identifiers the runtime shim uses to register the model in the scoped host
  // registry so cross-widget interop can find each other.
  model._myst_root_id = rootId;
  if ((state as any)._anywidget_id) model._myst_anywidget_id = (state as any)._anywidget_id;
  return model;
}
