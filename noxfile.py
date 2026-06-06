"""Nox sessions for myst-anywidget-static-export."""

import nox

# Use uv for faster installs, falling back to virtualenv.
nox.options.default_venv_backend = "uv|virtualenv"

# Pinned so demo-notebook regeneration is reproducible across machines.
WIDGET_DEPS = ("anywidget==0.11.0", "ipywidgets==8.1.8")


def _regenerate_demos(session):
    """Rebuild the committed demo-notebook widget state from the widget source.

    Output is deterministic (see docs/generate_demos.py), so this is a no-op for
    git when the demo widgets are unchanged.
    """
    session.install(*WIDGET_DEPS)
    session.run("python", "docs/generate_demos.py")


@nox.session(name="build")
def build_plugin(session):
    """Build the plugin (two-pass esbuild) and copy it into docs/."""
    session.run("npm", "install", external=True)
    session.run("npm", "run", "build", external=True)
    session.run("cp", "dist/plugin.mjs", "docs/plugin.mjs", external=True)


@nox.session(name="gen-demos")
def gen_demos(session):
    """Regenerate the docs demo notebooks' committed widget state."""
    _regenerate_demos(session)


@nox.session(name="test")
def test(session):
    """Run the vitest suite (builds the plugin first)."""
    build_plugin(session)
    session.run("npm", "test", external=True)


@nox.session(name="docs")
def docs(session):
    """Build the documentation site as static HTML."""
    session.install("mystmd")
    build_plugin(session)
    _regenerate_demos(session)
    session.chdir("docs")
    session.run("myst", "build", "--html")


@nox.session(name="docs-live")
def docs_live(session):
    """Start a live development server for the documentation site."""
    session.install("mystmd")
    build_plugin(session)
    _regenerate_demos(session)
    session.chdir("docs")
    session.run("myst", "start")


@nox.session
def clean(session):
    """Clean the documentation build artifacts."""
    session.install("mystmd")
    session.chdir("docs")
    session.run("myst", "clean", "--all")
