// Reference normalization and key helpers shared by the registry.

export function normalizeRef(ref: any): any {
  if (typeof ref !== "string") return ref;
  if (ref.startsWith("anywidget:")) return ref.slice("anywidget:".length);
  if (ref.startsWith("IPY_MODEL_")) return ref.slice("IPY_MODEL_".length);
  return ref;
}

export function uniqueKeys(keys: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < (keys || []).length; i++) {
    const key = normalizeRef(keys[i]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

// Lookup keys for a model: its UUID (rootId), user-set widget_id, the
// _anywidget_id Python class path, and lonboard layer/control type aliases.
export function keysForState(state: any, rootId: any): any[] {
  const keys: any[] = [rootId, state && state.widget_id, state && state._anywidget_id];
  if (state && state._layer_type) keys.push("_layer_type:" + state._layer_type);
  if (state && state._control_type) keys.push("_control_type:" + state._control_type);
  return keys;
}
