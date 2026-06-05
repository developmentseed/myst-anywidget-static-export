// Runtime for MyST static anywidget exports.
//
// This module is bundled to a string at build time (scripts/build.mjs) and
// shipped to the browser as the shared host module. Generated wrapper modules
// import `initializeStaticWidget` / `renderStaticWidget` from it, keeping the
// user's original ESM untouched while shaping the browser-side glue around
// anywidget AFM concepts: AnyModel, a scoped registry, and host.getModel/getWidget.

import { ensureShadowCss } from "./css.js";
import { host, registry, setupModel } from "./registry.js";
import { keysForState } from "./refs.js";

function normalizeModule(mod: any): any {
  const candidate = mod && mod.default !== undefined ? mod.default : mod;
  if (typeof candidate === "function") return candidate;
  return candidate || {};
}

export async function initializeStaticWidget(userModule: any, args: any): Promise<any> {
  let widget = normalizeModule(userModule);
  setupModel(args.model);
  const nextArgs = Object.assign({}, args, { host: host() });
  if (typeof widget === "function") {
    widget = await widget(nextArgs);
  }
  let exports: any = undefined;
  if (widget && typeof widget.initialize === "function") {
    const result = await widget.initialize(nextArgs);
    if (result && typeof result === "object") exports = result;
  }
  const rootId = args.model && args.model.get && args.model.get("_myst_root_id");
  const widgetId = args.model && args.model.get && args.model.get("widget_id");
  const anywidgetId = args.model && args.model.get && args.model.get("_myst_anywidget_id");
  const reg = registry();
  reg.registerBinding(args.model, {
    keys: keysForState({ widget_id: widgetId, _anywidget_id: anywidgetId }, rootId),
    exports,
    render: (opts: any) =>
      renderStaticWidget(widget, Object.assign({}, opts, { model: args.model })),
  });
  args.model.__mystUserWidget = widget;
  args.model.__mystUserExports = exports;
  return exports;
}

export async function renderStaticWidget(userModule: any, args: any): Promise<any> {
  let widget =
    args.model && args.model.__mystUserWidget
      ? args.model.__mystUserWidget
      : normalizeModule(userModule);
  setupModel(args.model);
  if (args.model && args.model.get) {
    ensureShadowCss(
      args.el,
      args.model.get("_myst_css_text"),
      args.model.get("_myst_css_key"),
    );
  }
  const nextArgs = Object.assign({}, args, { host: args.host || host() });
  if (typeof widget === "function") {
    widget = await widget(nextArgs);
    if (args.model) args.model.__mystUserWidget = widget;
  }
  if (widget && typeof widget.render === "function") return widget.render(nextArgs);
}
