"""Nox sessions for myst-anywidget-static-export."""

import nox

# Use uv for faster installs, falling back to virtualenv.
nox.options.default_venv_backend = "uv|virtualenv"


@nox.session(name="build")
def build_plugin(session):
    """Build the plugin (two-pass esbuild) and copy it into docs/."""
    session.run("npm", "install", external=True)
    session.run("npm", "run", "build", external=True)
    session.run("cp", "dist/plugin.mjs", "docs/plugin.mjs", external=True)


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
    session.chdir("docs")
    session.run("myst", "build", "--html")


@nox.session(name="docs-live")
def docs_live(session):
    """Start a live development server for the documentation site."""
    session.install("mystmd")
    build_plugin(session)
    session.chdir("docs")
    session.run("myst", "start")


@nox.session
def clean(session):
    """Clean the documentation build artifacts."""
    session.install("mystmd")
    session.chdir("docs")
    session.run("myst", "clean", "--all")
