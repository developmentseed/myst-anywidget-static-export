// Shared test scaffolding for tests/transform.test.ts.
//
// The plugin re-reads the source `.ipynb` from `file.path`, then walks a
// hand-built AST to find `output` nodes carrying widget-view MIME data.
// These helpers (a) load the plugin's transform function in isolation,
// (b) stage fixtures in a tmpdir so the plugin can write sidecar assets
// without polluting the repo, and (c) build a minimal AST tree that exercises
// the same code paths a real mystmd parse would.
//
// We import the TypeScript source directly (resolved through Vite) so failures
// map to TS lines. `npm test` runs `npm run build` first, which produces
// src/generated/runtime-source.ts that src/plugin.ts depends on.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import plugin from "../src/plugin.js";
import type { MystNode, VFile } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

export const WIDGET_VIEW_MIME = "application/vnd.jupyter.widget-view+json";

export type Transform = (tree: MystNode, file: VFile) => void | Promise<void>;

// Load the plugin's transform function. The plugin exports
// `{ name, transforms: [{ plugin: factory }] }` where `factory()` returns the
// actual async `(tree, file) => {}` we want to call.
export async function loadTransform(): Promise<Transform> {
  return plugin.transforms[0].plugin();
}

// Run `fn` against a fresh copy of `<fixturesDir>/<fixtureName>` placed in a
// per-call tmpdir. The tmpdir is removed when `fn` resolves or throws.
export async function inTmpDir<T>(
  fixtureName: string,
  fn: (ctx: { dir: string; notebookPath: string }) => Promise<T>,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anywidget-test-"));
  const dest = path.join(dir, fixtureName);
  fs.copyFileSync(path.join(FIXTURES_DIR, fixtureName), dest);
  try {
    return await fn({ dir, notebookPath: dest });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Build a minimal MyST AST tree for the notebook at `notebookPath`.
//
// Mirrors what mystmd produces when parsing a notebook: each code cell becomes a
// `block` containing one `output` node per output, with each MIME entry wrapped
// as `{ content: <data> }` (so `parseViewMime` can read it).
export function buildAstForNotebook(notebookPath: string): MystNode {
  const nb = JSON.parse(fs.readFileSync(notebookPath, "utf8"));
  const blocks: MystNode[] = [];
  for (const cell of nb.cells ?? []) {
    if (cell.cell_type !== "code") continue;
    const outputNodes: MystNode[] = [];
    for (const out of cell.outputs ?? []) {
      const data = out.data ?? {};
      const wrappedData: Record<string, { content: unknown }> = {};
      for (const [mime, value] of Object.entries(data)) {
        wrappedData[mime] = { content: value };
      }
      outputNodes.push({ type: "output", jupyter_data: { data: wrappedData } });
    }
    if (outputNodes.length === 0) continue;
    blocks.push({ type: "block", children: outputNodes });
  }
  return { type: "root", children: blocks };
}

// Walk the AST and return all nodes whose type matches `type`.
export function nodesOfType(tree: MystNode, type: string): MystNode[] {
  const out: MystNode[] = [];
  function visit(n: any) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (n.type === type) out.push(n);
    if (Array.isArray(n.children)) n.children.forEach(visit);
  }
  visit(tree);
  return out;
}

// Sorted directory listing — handy for snapshot-style assertions.
export function assetsIn(assetDir: string): string[] {
  if (!fs.existsSync(assetDir)) return [];
  return fs.readdirSync(assetDir).sort();
}
