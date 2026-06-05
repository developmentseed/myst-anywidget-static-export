// Generate the .ipynb fixture files used by tests/static-export.test.mjs.
//
// Each fixture is a tiny notebook (one or two cells, hand-built widget state)
// that exercises a specific code path in plugins/anywidget-static-export.mjs.
// Run with `node tests/fixtures/build.mjs` after editing fixture data here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRIVIAL_ESM = `export default {
  render({ model, el }) {
    el.textContent = String(model.get("value"));
  }
};
`;

const TRIVIAL_CSS = `.counter { color: red; }\n`;

function notebook({ cells, widgetState }) {
  return {
    cells,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python", version: "3.11" },
      widgets: widgetState
        ? {
            "application/vnd.jupyter.widget-state+json": {
              version_major: 2,
              version_minor: 0,
              state: widgetState,
            },
          }
        : undefined,
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

function widgetViewCell(modelId, source = "Widget()") {
  return {
    cell_type: "code",
    execution_count: 1,
    metadata: {},
    source,
    outputs: [
      {
        output_type: "display_data",
        data: {
          "application/vnd.jupyter.widget-view+json": {
            model_id: modelId,
            version_major: 2,
            version_minor: 0,
          },
          "text/plain": "Widget()",
        },
        metadata: {},
      },
    ],
  };
}

function anywidgetEntry(state, buffers = []) {
  return {
    model_module: "anywidget",
    model_module_version: "*",
    model_name: "AnyWidgetModel",
    state: { _esm: TRIVIAL_ESM, ...state },
    buffers,
  };
}

const FIXTURES = {
  // Counter: simplest case — one anywidget, no buffers, no submodels, no css.
  "simple-counter.ipynb": notebook({
    cells: [widgetViewCell("counter1")],
    widgetState: {
      counter1: anywidgetEntry({
        value: 0,
        label: "Test",
        widget_id: "counter_1",
        _anywidget_id: "tests.Counter",
      }),
    },
  }),

  // VBox container holding an anywidget child. The cell output points at the
  // VBox; the plugin must walk into children to find the anywidget descendant.
  "vbox-container.ipynb": notebook({
    cells: [widgetViewCell("vbox1", "VBox([CounterWidget()])")],
    widgetState: {
      vbox1: {
        model_module: "@jupyter-widgets/controls",
        model_module_version: "*",
        model_name: "VBoxModel",
        state: { children: ["IPY_MODEL_inner1"] },
        buffers: [],
      },
      inner1: anywidgetEntry({
        value: 7,
        label: "Inner",
        widget_id: "inner_widget",
      }),
    },
  }),

  // Widget with binary buffers attached to its root entry.
  "with-buffers.ipynb": notebook({
    cells: [widgetViewCell("buffered1")],
    widgetState: {
      buffered1: anywidgetEntry(
        {
          value: 0,
          data: [null],
          widget_id: "buf_widget",
        },
        [
          {
            encoding: "base64",
            path: ["data", 0],
            data: "AAECAwQF",
          },
        ],
      ),
    },
  }),

  // Sub-model graph: root → IPY_MODEL_a → IPY_MODEL_b. All three should be
  // walked, but only `a` and `b` should land in _myst_submodels (root is excluded).
  "submodel-graph.ipynb": notebook({
    cells: [widgetViewCell("rootmodel")],
    widgetState: {
      rootmodel: anywidgetEntry({
        value: 0,
        layers: ["IPY_MODEL_layer_a"],
        widget_id: "graph_root",
      }),
      layer_a: {
        model_module: "@jupyter-widgets/controls",
        model_module_version: "*",
        model_name: "LayerModel",
        state: { kind: "scatter", child: "IPY_MODEL_layer_b" },
        buffers: [],
      },
      layer_b: {
        model_module: "@jupyter-widgets/controls",
        model_module_version: "*",
        model_name: "LayerModel",
        state: { kind: "leaf" },
        buffers: [],
      },
    },
  }),

  // Notebook with no widget state at all: tree should be unchanged.
  "no-widgets.ipynb": notebook({
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: ["# Plain notebook\n\nNo widgets here."],
      },
    ],
    widgetState: null,
  }),

  // Two anywidgets in one notebook — manifest should list both.
  "multi-widget.ipynb": notebook({
    cells: [widgetViewCell("alpha"), widgetViewCell("beta")],
    widgetState: {
      alpha: anywidgetEntry({ value: 1, widget_id: "alpha" }),
      beta: anywidgetEntry({ value: 2, widget_id: "beta" }),
    },
  }),

  // Two anywidgets linked by an ipywidgets LinkModel. The plugin should lift
  // the LinkModel into each exported widget model's page-level _myst_links
  // manifest and suppress the plain-text Link(...) repr output.
  "jslink.ipynb": notebook({
    cells: [
      widgetViewCell("source", "source"),
      widgetViewCell("target", "target"),
      {
        cell_type: "code",
        execution_count: 2,
        metadata: {},
        source: "w.jslink((source, 'value'), (target, 'value'))",
        outputs: [
          {
            output_type: "execute_result",
            execution_count: 2,
            data: {
              "text/plain": "Link(source=(Counter(value=1), 'value'), target=(Counter(value=2), 'value'))",
            },
            metadata: {},
          },
        ],
      },
    ],
    widgetState: {
      source: anywidgetEntry({ value: 1, widget_id: "source" }),
      target: anywidgetEntry({ value: 2, widget_id: "target" }),
      link: {
        model_module: "@jupyter-widgets/controls",
        model_module_version: "2.0.0",
        model_name: "LinkModel",
        state: {
          source: ["IPY_MODEL_source", "value"],
          target: ["IPY_MODEL_target", "value"],
        },
        buffers: [],
      },
    },
  }),

  // Counter with CSS — exercises the _css → _myst_css_text path and the
  // deliberate omission of node.css.
  "with-css.ipynb": notebook({
    cells: [widgetViewCell("styled1")],
    widgetState: {
      styled1: {
        model_module: "anywidget",
        model_module_version: "*",
        model_name: "AnyWidgetModel",
        state: {
          _esm: TRIVIAL_ESM,
          _css: TRIVIAL_CSS,
          value: 0,
          widget_id: "styled",
        },
        buffers: [],
      },
    },
  }),
};

for (const [name, nb] of Object.entries(FIXTURES)) {
  const filePath = path.join(__dirname, name);
  fs.writeFileSync(filePath, JSON.stringify(nb, null, 1) + "\n");
  console.log("wrote", path.relative(process.cwd(), filePath));
}
