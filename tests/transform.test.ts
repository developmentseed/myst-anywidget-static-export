// Behavior tests for the anywidget-static-export plugin.
//
// These assert on the input → output contract: given a notebook + AST with
// `output` nodes, the plugin must rewrite the right nodes to `anywidget`,
// surface widget state on `node.model`, and emit the expected sidecar files.
// Tests deliberately avoid asserting on internal implementation details
// (filename hashes, runtime source, registry plumbing) so the plugin can be
// refactored internally without breaking them.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

import {
  loadTransform,
  inTmpDir,
  buildAstForNotebook,
  nodesOfType,
  assetsIn,
  type Transform,
} from "./helpers.js";

let transform: Transform;
beforeAll(async () => {
  transform = await loadTransform();
});

const ASSETS = "_widget_assets";

describe("anywidget-static-export plugin", () => {
  it("rewrites a simple counter widget output to an anywidget node", async () => {
    await inTmpDir("simple-counter.ipynb", async ({ dir, notebookPath }) => {
      const tree = buildAstForNotebook(notebookPath);
      await transform(tree, { path: notebookPath });

      const widgets = nodesOfType(tree, "anywidget") as any[];
      expect(widgets).toHaveLength(1);
      const [node] = widgets;
      expect(node.id).toBe("counter1");
      expect(node.esm).toMatch(/_widget_assets\/.+\.wrapper\.mjs$/);
      expect(node.children).toEqual([]);
      expect(node.model.value).toBe(0);
      expect(node.model.label).toBe("Test");
      expect(node.model.widget_id).toBe("counter_1");
      expect(node.key).toBeTruthy();

      // Original output node should be gone.
      expect(nodesOfType(tree, "output")).toHaveLength(0);

      const files = assetsIn(path.join(dir, ASSETS));
      expect(files.some((f) => f.endsWith(".wrapper.mjs"))).toBe(true);
      expect(files.some((f) => f.endsWith(".source.mjs"))).toBe(true);
      expect(files.some((f) => f.endsWith(".state.json"))).toBe(true);
      expect(files).toContain("manifest.json");
    });
  });

  it("unwraps a VBox container and rewrites the inner anywidget", async () => {
    await inTmpDir("vbox-container.ipynb", async ({ notebookPath }) => {
      const tree = buildAstForNotebook(notebookPath);
      await transform(tree, { path: notebookPath });

      const widgets = nodesOfType(tree, "anywidget") as any[];
      expect(widgets).toHaveLength(1);
      // The cell output pointed at vbox1, but the rewritten node should identify
      // the inner anywidget child, not the container.
      expect(widgets[0].id).toBe("inner1");
      expect(widgets[0].model.value).toBe(7);
      expect(widgets[0].model.widget_id).toBe("inner_widget");
    });
  });

  it("preserves base64 buffers on the widget model", async () => {
    await inTmpDir("with-buffers.ipynb", async ({ notebookPath }) => {
      const tree = buildAstForNotebook(notebookPath);
      await transform(tree, { path: notebookPath });

      const [node] = nodesOfType(tree, "anywidget") as any[];
      const buffers = node.model._myst_buffers;
      expect(Array.isArray(buffers)).toBe(true);
      expect(buffers).toHaveLength(1);
      expect(buffers[0]).toMatchObject({
        encoding: "base64",
        data: "AAECAwQF",
        path: ["data", 0],
      });
    });
  });

  it("bundles transitively-reachable submodels (excluding the root)", async () => {
    await inTmpDir("submodel-graph.ipynb", async ({ notebookPath }) => {
      const tree = buildAstForNotebook(notebookPath);
      await transform(tree, { path: notebookPath });

      const [node] = nodesOfType(tree, "anywidget") as any[];
      const submodels = node.model._myst_submodels;
      const ids = Object.keys(submodels).sort();
      expect(ids).toEqual(["layer_a", "layer_b"]);
      // Root must not appear in the submodel bundle.
      expect(ids).not.toContain("rootmodel");
      // Sub-model bundle should preserve user state.
      expect(submodels.layer_a.state.kind).toBe("scatter");
      expect(submodels.layer_b.state.kind).toBe("leaf");
    });
  });

  it("bundles container children as renderable submodels (siblings not dropped)", async () => {
    await inTmpDir("container-children.ipynb", async ({ notebookPath }) => {
      const tree = buildAstForNotebook(notebookPath);
      await transform(tree, { path: notebookPath });

      const widgets = nodesOfType(tree, "anywidget") as any[];
      expect(widgets).toHaveLength(1);
      const [node] = widgets;
      // The container itself is the rewritten root; its child refs are preserved.
      expect(node.id).toBe("container1");
      expect(node.model.children).toEqual(["IPY_MODEL_childA", "IPY_MODEL_childB"]);

      // Both children are bundled (neither sibling dropped), each carrying its own
      // _esm and _css so host.renderChild can mount and style it at runtime.
      const submodels = node.model._myst_submodels;
      expect(Object.keys(submodels).sort()).toEqual(["childA", "childB"]);
      for (const id of ["childA", "childB"]) {
        expect(typeof submodels[id].state._esm).toBe("string");
        expect(submodels[id].state._esm.length).toBeGreaterThan(0);
        expect(typeof submodels[id].state._css).toBe("string");
      }
      expect(submodels.childA.state._css).toMatch(/\.child-a/);
      expect(submodels.childB.state._css).toMatch(/\.child-b/);
    });
  });

  it("inlines CSS on the model and never sets node.css", async () => {
    await inTmpDir("with-css.ipynb", async ({ dir, notebookPath }) => {
      const tree = buildAstForNotebook(notebookPath);
      await transform(tree, { path: notebookPath });

      const [node] = nodesOfType(tree, "anywidget") as any[];
      expect(node.model._myst_css_text).toMatch(/\.counter \{ color: red; \}/);
      expect(node.model._myst_css_key).toBeTruthy();
      // Deliberate: CSS goes through the runtime shim into the shadow root, not
      // via node.css (which the renderer would put inside the user's div where
      // React's createRoot wipes it).
      expect(node.css).toBeUndefined();

      const files = assetsIn(path.join(dir, ASSETS));
      expect(files.some((f) => f.endsWith(".css"))).toBe(true);
    });
  });

  it("leaves notebooks without widget state untouched", async () => {
    await inTmpDir("no-widgets.ipynb", async ({ dir, notebookPath }) => {
      const tree = buildAstForNotebook(notebookPath);
      const before = JSON.stringify(tree);
      await transform(tree, { path: notebookPath });
      expect(JSON.stringify(tree)).toBe(before);
      expect(nodesOfType(tree, "anywidget")).toHaveLength(0);
      expect(fs.existsSync(path.join(dir, ASSETS))).toBe(false);
    });
  });

  it("lists every exported widget in the page manifest", async () => {
    await inTmpDir("multi-widget.ipynb", async ({ dir, notebookPath }) => {
      const tree = buildAstForNotebook(notebookPath);
      await transform(tree, { path: notebookPath });

      expect(nodesOfType(tree, "anywidget")).toHaveLength(2);

      const manifestPath = path.join(dir, ASSETS, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const pageEntry = manifest.pages["multi-widget.ipynb"];
      expect(pageEntry.widgets).toHaveLength(2);
      const ids = pageEntry.widgets.map((w: any) => w.id).sort();
      expect(ids).toEqual(["alpha", "beta"]);
    });
  });

  it("lifts LinkModel state into the host registry link manifest", async () => {
    await inTmpDir("jslink.ipynb", async ({ dir, notebookPath }) => {
      const tree = buildAstForNotebook(notebookPath);
      await transform(tree, { path: notebookPath });

      const widgets = nodesOfType(tree, "anywidget") as any[];
      expect(widgets).toHaveLength(2);
      expect(nodesOfType(tree, "output")).toHaveLength(0);

      for (const node of widgets) {
        expect(node.id).not.toMatch(/^__myst_jslink_runtime_/);
        expect(node.model._myst_links).toEqual([
          {
            id: "link",
            bidirectional: true,
            sourceId: "source",
            sourceAttr: "value",
            targetId: "target",
            targetAttr: "value",
          },
        ]);
      }

      const manifestPath = path.join(dir, ASSETS, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const pageEntry = manifest.pages["jslink.ipynb"];
      expect(pageEntry.widgets.map((w: any) => w.id).sort()).toEqual(["source", "target"]);
      expect(pageEntry.links).toHaveLength(1);
      expect(pageEntry.links[0]).toMatchObject({
        id: "link",
        bidirectional: true,
        sourceId: "source",
        targetId: "target",
      });
    });
  });

  it("is idempotent across runs (writeFileIfChanged keeps mtimes stable)", async () => {
    await inTmpDir("simple-counter.ipynb", async ({ dir, notebookPath }) => {
      const tree1 = buildAstForNotebook(notebookPath);
      await transform(tree1, { path: notebookPath });
      const assetDir = path.join(dir, ASSETS);
      const firstRun = Object.fromEntries(
        assetsIn(assetDir).map((f) => [f, fs.statSync(path.join(assetDir, f)).mtimeMs]),
      );

      // Re-run with a fresh tree against the same notebook + asset dir.
      const tree2 = buildAstForNotebook(notebookPath);
      await transform(tree2, { path: notebookPath });
      const secondRun = Object.fromEntries(
        assetsIn(assetDir).map((f) => [f, fs.statSync(path.join(assetDir, f)).mtimeMs]),
      );

      expect(Object.keys(secondRun).sort()).toEqual(Object.keys(firstRun).sort());
      for (const file of Object.keys(firstRun)) {
        expect(secondRun[file]).toBe(firstRun[file]);
      }
    });
  });
});
