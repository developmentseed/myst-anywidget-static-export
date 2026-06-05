"""
Simple counter widget demonstrating anywidget basics and inter-widget communication.
"""
import anywidget
import traitlets
import pathlib


class CounterWidget(anywidget.AnyWidget):
    """A simple counter widget with increment/decrement buttons."""
    
    # Path to the JavaScript module
    _esm = pathlib.Path(__file__).parent / "widget.js"
    _css = pathlib.Path(__file__).parent / "style.css"
    
    # Widget state synchronized between Python and JavaScript
    value = traitlets.Int(0).tag(sync=True)
    label = traitlets.Unicode("Counter").tag(sync=True)
    
    # Widget ID for inter-widget communication
    widget_id = traitlets.Unicode("counter_1").tag(sync=True)
    
    # Event tracking
    last_change = traitlets.Dict({}).tag(sync=True)
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.observe(self._on_value_change, names=['value'])
    
    def _on_value_change(self, change):
        """Track value changes for debugging and inter-widget communication."""
        self.last_change = {
            'old': change['old'],
            'new': change['new'],
            'widget_id': self.widget_id
        }
    
    def reset(self):
        """Reset the counter to zero."""
        self.value = 0
    
    def increment(self, amount=1):
        """Increment the counter."""
        self.value += amount
    
    def decrement(self, amount=1):
        """Decrement the counter."""
        self.value -= amount