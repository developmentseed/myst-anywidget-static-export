"""
A minimal layout container anywidget that arranges child anywidgets side by side.

It exists to demonstrate the static-export container-renderer contract: the
container declares its child-ref traits via `_myst_child_traits`, and its JS
mounts each child with `host.renderChild(ref, el)` so the children render
(still linked) with no kernel attached.
"""
import pathlib

import anywidget
import traitlets
from ipywidgets import Widget, widget_serialization


class Row(anywidget.AnyWidget):
    """Lay out child widgets in a horizontal flex row."""

    _esm = pathlib.Path(__file__).parent / "widget.js"
    _css = pathlib.Path(__file__).parent / "style.css"

    # The children to render side by side.
    children = traitlets.List(trait=traitlets.Instance(Widget)).tag(
        sync=True, **widget_serialization
    )

    # The contract marker the static-export plugin reads: which traits hold the
    # child anywidget refs the container will render itself.
    _myst_child_traits = traitlets.List(["children"]).tag(sync=True)

    gap = traitlets.Unicode("16px").tag(sync=True)

    def __init__(self, children=(), **kwargs):
        super().__init__(children=list(children), **kwargs)
