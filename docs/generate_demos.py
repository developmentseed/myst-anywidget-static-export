"""Regenerate the committed widget state for the docs demo notebooks.

The docs site is built from *already-executed* notebooks — `nox -s docs` does not
run a kernel, so each demo notebook must carry its widget state in
`metadata.widgets`. This script rebuilds that state from the widget source in
`docs/widgets/` so the notebooks never drift from the code.

Run it whenever you change a demo widget:

    nox -s gen-demos          # installs anywidget + ipywidgets, then runs this
    # or, in an env that already has the deps:
    python docs/generate_demos.py

Output is **deterministic**: ipywidgets assigns random UUID model ids, so we remap
them to stable slugs before writing. Re-running with unchanged widgets produces a
byte-identical notebook (no git churn).
"""
import json
import pathlib
import sys

DOCS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(DOCS))

from ipywidgets import Widget, jslink  # noqa: E402

from widgets.counter import CounterWidget  # noqa: E402
from widgets.row import Row  # noqa: E402


def _md(cell_id, text):
    return {"cell_type": "markdown", "id": cell_id, "metadata": {}, "source": text}


def _code(cell_id, source, outputs=None):
    return {
        "cell_type": "code",
        "id": cell_id,
        "execution_count": None,
        "metadata": {},
        "outputs": outputs or [],
        "source": source,
    }


def _notebook(cells, widget_state):
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.11"},
            "widgets": {
                "application/vnd.jupyter.widget-state+json": {
                    "version_major": 2,
                    "version_minor": 0,
                    "state": widget_state,
                }
            },
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def _write_deterministic(out_path, notebook, id_map):
    """Serialize, then rewrite random UUID model ids to stable slugs.

    Each id is a unique 32-hex UUID, so a plain text replace is safe and also
    fixes `IPY_MODEL_<id>` refs, the widget-view `model_id`, and link source/target.
    """
    text = json.dumps(notebook, indent=1) + "\n"
    for old_id, new_id in id_map.items():
        text = text.replace(old_id, new_id)
    out_path.write_text(text)


def build_container_demo():
    """Row([CounterWidget, CounterWidget]) with the two counters jslinked."""
    a = CounterWidget(label="Left counter", widget_id="counter_left", value=2)
    b = CounterWidget(label="Right counter", widget_id="counter_right", value=2)
    # Keep the two children in sync to show cross-child links survive static export.
    jslink((a, "value"), (b, "value"))
    row = Row(children=[a, b], gap="24px")

    state = Widget.get_manager_state(drop_defaults=False)["state"]

    # Stable slugs for every model so the output is reproducible. Known widgets map
    # directly; their LayoutModels are reached via each widget's `layout` ref; the
    # sole LinkModel is found by model_name.
    def layout_ref(widget):
        return state[widget.model_id]["state"]["layout"].removeprefix("IPY_MODEL_")

    id_map = {
        row.model_id: "row_demo",
        a.model_id: "counter_left",
        b.model_id: "counter_right",
        layout_ref(row): "layout_row",
        layout_ref(a): "layout_left",
        layout_ref(b): "layout_right",
    }
    links = [mid for mid, m in state.items() if m.get("model_name") == "LinkModel"]
    if len(links) != 1:
        raise RuntimeError(f"expected exactly one LinkModel, found {len(links)}")
    id_map[links[0]] = "link_left_right"

    # Sanity: every model must get a stable slug, or output won't be deterministic.
    unmapped = set(state) - set(id_map)
    if unmapped:
        raise RuntimeError(f"unmapped model ids (output would not be deterministic): {unmapped}")

    display_output = {
        "output_type": "execute_result",
        "execution_count": None,
        "data": {
            "application/vnd.jupyter.widget-view+json": {
                "model_id": row.model_id,
                "version_major": 2,
                "version_minor": 0,
            },
            "text/plain": "Row(children=(CounterWidget(...), CounterWidget(...)))",
        },
        "metadata": {},
    }

    cells = [
        _md(
            "intro-md",
            "# 2. A container of anywidgets, statically\n"
            "\n"
            "This page renders a **layout container** anywidget — a `Row` that "
            "arranges two child counters side by side — with no kernel attached. "
            "The children stay live (click `+`/`-`) and stay **linked**: because "
            "the two counters are `jslink`ed, changing one updates the other, all "
            "in static HTML.\n"
            "\n"
            "The container works via the plugin's container-renderer hook: the "
            "`Row`'s JS calls `host.renderChild(ref, el)` for each child ref, and "
            "the runtime mounts each referenced anywidget (with its own ESM + CSS) "
            "into the row's DOM.",
        ),
        _md(
            "widget-py-md",
            "## The container\n"
            "\n"
            "`widgets/row/widget.py` is a tiny `anywidget.AnyWidget` whose "
            "`children` trait holds child widgets and which declares "
            "`_myst_child_traits = ['children']` so the static-export plugin knows "
            "those refs are renderable. `widgets/row/widget.js` reads the child "
            "refs and mounts each with `host.renderChild`.",
        ),
        _code(
            "import-cell",
            "import sys, pathlib\n"
            "sys.path.insert(0, str(pathlib.Path().absolute()))\n"
            "from ipywidgets import jslink\n"
            "from widgets.counter import CounterWidget\n"
            "from widgets.row import Row",
        ),
        _md("demo-md", "Build two linked counters and arrange them in a row:"),
        _code(
            "demo-cell",
            'a = CounterWidget(label="Left counter", widget_id="counter_left", value=2)\n'
            'b = CounterWidget(label="Right counter", widget_id="counter_right", value=2)\n'
            'jslink((a, "value"), (b, "value"))\n'
            'Row(children=[a, b], gap="24px")',
            outputs=[display_output],
        ),
    ]

    out = DOCS / "container-demo.ipynb"
    _write_deterministic(out, _notebook(cells, state), id_map)
    print(f"wrote {out.relative_to(DOCS.parent)} ({len(state)} models)")


if __name__ == "__main__":
    build_container_demo()
