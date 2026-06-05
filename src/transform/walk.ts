// AST walking helpers. No I/O, pure tree traversal.

import type { MimeValue, MystNode, NodeWithParent } from "../types.js";

export function findOutputs(node: any, results: MystNode[] = []): MystNode[] {
  if (!node || typeof node !== "object") return results;
  if (Array.isArray(node)) {
    for (const n of node) findOutputs(n, results);
    return results;
  }
  if (node.type === "output") results.push(node);
  if (Array.isArray(node.children)) {
    for (const c of node.children) findOutputs(c, results);
  }
  return results;
}

// Same walk as findOutputs but also yields the parent node holding the output.
// We use the parent for output removal, e.g. suppressing the text repr emitted
// by jslink/jsdlink-only cells.
export function findOutputsWithParent(tree: MystNode): NodeWithParent[] {
  const results: NodeWithParent[] = [];
  function visit(node: any, parent: MystNode | null) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, parent);
      return;
    }
    if (node.type === "output") results.push({ node, parent });
    if (Array.isArray(node.children)) {
      for (const c of node.children) visit(c, node);
    }
  }
  visit(tree, null);
  return results;
}

export function parseViewMime(viewMime: MimeValue | undefined): any {
  if (!viewMime) return null;
  const raw = typeof viewMime.content === "string" ? viewMime.content : null;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return viewMime.content ?? null;
}
