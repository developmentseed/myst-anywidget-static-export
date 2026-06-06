// Cross-widget interop registry. Populated by setupModel for each root and every
// transitively-referenced sub-model. Keyed by widget_id (user-set), by
// _anywidget_id (Python class path, e.g. "lonboard._map.Map"), and by model_id
// (UUID from the kernel). Lookups can use any of these keys.

import { base64ToArrayBuffer, putBuffers } from "./buffers.js";
import { ensureShadowCss } from "./css.js";
import { Emitter } from "./emitter.js";
import { SubModel } from "./submodel.js";
import { keysForState, normalizeRef, uniqueKeys } from "./refs.js";

function normalizeWidgetModule(mod: any): any {
  const candidate = mod && mod.default !== undefined ? mod.default : mod;
  if (typeof candidate === "function") return candidate;
  return candidate || {};
}

declare global {
  // eslint-disable-next-line no-var
  interface Window {
    __myst_anywidget_hosts?: Map<string, Registry>;
  }
}

const MODEL_REGISTERED_EVENT = "model:registered";
const WIDGET_REGISTERED_EVENT = "widget:registered";

export interface Registry {
  register(model: any, keys: any[]): void;
  get(key: any): any;
  findFirst(pred: (m: any) => boolean): any;
  filter(pred: (m: any) => boolean): any[];
  all(): any[];
  registerBinding(model: any, binding: any): void;
  installLinks(links: any[]): void;
  getBinding(key: any): any;
  getModel(ref: any): Promise<any>;
  waitForModel(ref: any, options?: { timeout?: number }): Promise<any>;
  getWidget(ref: any): Promise<any>;
  renderChild(ref: any, el: any): Promise<() => void>;
  on(event: string, fn: (detail: any) => void): void;
  off(event: string, fn: Function): void;
  emit(event: string, detail?: any): void;
}

function createRegistry(): Registry {
  const _byKey = new Map<string, any>();
  const _all: any[] = [];
  const _bindings = new Map<string, any>();
  const _links = new Map<string, any>();
  const _boundLinks = new Set<string>();
  const _childModules = new Map<string, Promise<any>>();
  const _events = new Emitter();

  function linkKey(link: any): string {
    if (link && link.id) return String(link.id);
    return JSON.stringify([
      link && link.bidirectional ? "bi" : "dir",
      link && link.sourceId,
      link && link.sourceAttr,
      link && link.targetId,
      link && link.targetAttr,
    ]);
  }

  function bindLinkIfReady(link: any): void {
    const key = linkKey(link);
    if (_boundLinks.has(key)) return;
    const source = _byKey.get(normalizeRef(link.sourceId));
    const target = _byKey.get(normalizeRef(link.targetId));
    if (!source || !target) return;
    _boundLinks.add(key);
    let _updating = false;
    const fwd = () => {
      if (_updating) return;
      _updating = true;
      try {
        target.set(link.targetAttr, source.get(link.sourceAttr));
      } finally {
        _updating = false;
      }
    };
    source.on("change:" + link.sourceAttr, fwd);
    // Initial sync mirrors upstream LinkModel.updateBindings(): push source to target.
    fwd();
    if (link.bidirectional) {
      const rev = () => {
        if (_updating) return;
        _updating = true;
        try {
          source.set(link.sourceAttr, target.get(link.targetAttr));
        } finally {
          _updating = false;
        }
      };
      target.on("change:" + link.targetAttr, rev);
    }
  }

  function bindReadyLinks(): void {
    for (const link of _links.values()) bindLinkIfReady(link);
  }

  function installLinks(links: any[]): void {
    if (!Array.isArray(links)) return;
    for (const link of links) {
      if (!link || !link.sourceId || !link.targetId || !link.sourceAttr || !link.targetAttr)
        continue;
      const key = linkKey(link);
      if (_links.has(key)) continue;
      _links.set(key, link);
    }
    bindReadyLinks();
  }

  function registerModel(model: any, keys: any[]): void {
    const registeredKeys: string[] = [];
    for (const key of uniqueKeys(keys)) {
      if (_byKey.has(key)) continue;
      _byKey.set(key, model);
      registeredKeys.push(key);
    }
    if (_all.indexOf(model) < 0) _all.push(model);
    for (const key of registeredKeys) {
      _events.emit(MODEL_REGISTERED_EVENT, { key, model });
    }
    bindReadyLinks();
  }

  function registerBinding(model: any, binding: any): void {
    const keys = uniqueKeys(binding && binding.keys);
    registerModel(model, keys);
    const registeredKeys: string[] = [];
    for (const key of keys) {
      if (_bindings.has(key)) continue;
      _bindings.set(key, binding);
      registeredKeys.push(key);
    }
    for (const key of registeredKeys) {
      _events.emit(WIDGET_REGISTERED_EVENT, { key, binding });
    }
  }

  function waitForModel(ref: any, options?: { timeout?: number }): Promise<any> {
    const key = normalizeRef(ref);
    const model = _byKey.get(key);
    if (model) return Promise.resolve(model);
    const timeout = options && typeof options.timeout === "number" ? options.timeout : 5000;
    return new Promise((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        _events.off(MODEL_REGISTERED_EVENT, onRegistered);
        if (timer) clearTimeout(timer);
      };
      const finish = (fn: (value: any) => void, value: any) => {
        if (done) return;
        done = true;
        cleanup();
        fn(value);
      };
      const onRegistered = (detail: any) => {
        if (detail && detail.key === key) finish(resolve, detail.model);
      };
      _events.on(MODEL_REGISTERED_EVENT, onRegistered);
      if (timeout >= 0) {
        timer = setTimeout(() => {
          finish(reject, new Error("[myst-host] timeout waiting for model: " + String(ref)));
        }, timeout);
      }
    });
  }

  function importChildModule(esm: string): Promise<any> {
    let promise = _childModules.get(esm);
    if (!promise) {
      const url = URL.createObjectURL(new Blob([esm], { type: "text/javascript" }));
      promise = import(/* @vite-ignore */ url);
      _childModules.set(esm, promise);
    }
    return promise;
  }

  // Render a referenced anywidget child into `el` and return its cleanup. This is
  // the inverse of the top-level render path (renderStaticWidget), but for a
  // SubModel proxy already registered by setupModel — so we deliberately do NOT
  // call setupModel here (it is MystAnyModel-specific and would clobber the
  // proxy's shared widget_manager). The child's _esm/_css already ride along in
  // _myst_submodels, so this needs no extra emitted assets. Reentrant: a child
  // that is itself a container can call renderChild for its own grandchildren.
  async function renderChild(ref: any, el: any): Promise<() => void> {
    const model = await waitForModel(ref);
    const esm = model && typeof model.get === "function" ? model.get("_esm") : null;
    if (!esm) throw new Error("[myst-host] child has no _esm: " + String(ref));
    const userModule = await importChildModule(esm);
    let widget = normalizeWidgetModule(userModule);
    ensureShadowCss(el, model.get("_css"));
    const nextArgs: any = { model, el, host: host() };
    if (typeof widget === "function") widget = await widget(nextArgs);
    if (widget && typeof widget.initialize === "function") await widget.initialize(nextArgs);
    let cleanup: any;
    if (widget && typeof widget.render === "function") cleanup = await widget.render(nextArgs);
    return typeof cleanup === "function" ? cleanup : () => {};
  }

  return {
    register: registerModel,
    get: (key: any) => _byKey.get(normalizeRef(key)),
    findFirst: (pred: (m: any) => boolean) => _all.find(pred),
    filter: (pred: (m: any) => boolean) => _all.filter(pred),
    all: () => _all.slice(),
    registerBinding,
    installLinks,
    getBinding: (key: any) => _bindings.get(normalizeRef(key)),
    getModel: (ref: any) => {
      const key = normalizeRef(ref);
      const model = _byKey.get(key);
      if (model) return Promise.resolve(model);
      return Promise.reject(new Error("[myst-host] unknown model: " + String(ref)));
    },
    waitForModel,
    getWidget: (ref: any) => {
      const key = normalizeRef(ref);
      const binding = _bindings.get(key);
      if (!binding) return Promise.reject(new Error("[myst-host] unknown widget: " + String(ref)));
      return Promise.resolve({ exports: binding.exports, render: binding.render });
    },
    renderChild,
    on: (event: string, fn: (detail: any) => void) => _events.on(event, fn),
    off: (event: string, fn: Function) => _events.off(event, fn),
    emit: (event: string, detail?: any) => _events.emit(event, detail),
  };
}

export function registry(): Registry {
  if (!window.__myst_anywidget_hosts) window.__myst_anywidget_hosts = new Map();
  const scope = document && document.baseURI ? document.baseURI : "default";
  if (!window.__myst_anywidget_hosts.has(scope)) {
    window.__myst_anywidget_hosts.set(scope, createRegistry());
  }
  return window.__myst_anywidget_hosts.get(scope)!;
}

export interface Host {
  getModel(ref: any): Promise<any>;
  waitForModel(ref: any, options?: { timeout?: number }): Promise<any>;
  getWidget(ref: any): Promise<any>;
  renderChild(ref: any, el: any): Promise<() => void>;
  on(event: string, fn: (detail: any) => void): void;
  off(event: string, fn: Function): void;
  emit(event: string, detail?: any): void;
}

export function host(): Host {
  const reg = registry();
  return {
    getModel: (ref: any) => reg.getModel(ref),
    waitForModel: (ref: any, options?: { timeout?: number }) => reg.waitForModel(ref, options),
    getWidget: (ref: any) => reg.getWidget(ref),
    renderChild: (ref: any, el: any) => reg.renderChild(ref, el),
    on: (event: string, fn: (detail: any) => void) => reg.on(event, fn),
    off: (event: string, fn: Function) => reg.off(event, fn),
    emit: (event: string, detail?: any) => reg.emit(event, detail),
  };
}

export function setupModel(model: any): void {
  if (!model || model.__mystSetupDone) return;
  model.__mystSetupDone = true;

  // (1) Patch methods that MystAnyModel stubs to throw "not implemented yet".
  // These are prototype data properties, so instance assignment shadows them.
  model.save_changes = function () {};
  model.send = function () {};

  // model.on must split space-separated names (Backbone/ipywidgets idiom) before
  // delegating to MystAnyModel's native on, which only matches exact event names.
  // Native off throws, so we can't delegate removal to it: track our wrappers and
  // deactivate them in our own off instead.
  const _on = typeof model.on === "function" ? model.on.bind(model) : null;
  const _active = new Map<string, Map<Function, { active: boolean }>>();
  const splitEvents = (event: any) => String(event).split(/\s+/).filter(Boolean);
  model.on = function (event: any, fn: any) {
    if (_on && typeof fn === "function") {
      for (const name of splitEvents(event)) {
        let perFn = _active.get(name);
        if (!perFn) {
          perFn = new Map();
          _active.set(name, perFn);
        }
        const rec = { active: true };
        perFn.set(fn, rec);
        _on(name, (detail: any) => {
          if (rec.active) fn(detail);
        });
      }
    }
    return model;
  };
  model.off = function (event: any, fn: any) {
    for (const name of splitEvents(event)) {
      const perFn = _active.get(name);
      const rec = perFn && perFn.get(fn);
      if (rec) {
        rec.active = false;
        perFn!.delete(fn);
      }
    }
    return model;
  };

  // (2) Hydrate root buffers into the model's top-level state via mutation.
  const rootBuffers =
    (typeof model.get === "function" && model.get("_myst_buffers")) || [];
  if (Array.isArray(rootBuffers) && rootBuffers.length > 0) {
    const grouped = new Map<any, any[]>();
    for (const buf of rootBuffers) {
      const topKey = buf.path[0];
      if (!grouped.has(topKey)) grouped.set(topKey, []);
      grouped.get(topKey)!.push(buf);
    }
    for (const [topKey, bufs] of grouped.entries()) {
      const localPaths = bufs.map((b) => b.path.slice(1));
      const arrayBuffers = bufs.map((b) => base64ToArrayBuffer(b.data));
      // path length 1 means the whole top-level value IS the buffer; set() it back
      // (e.g. a traitlets.Bytes() trait is stripped to null in transport).
      if (bufs.length === 1 && bufs[0].path.length === 1) {
        model.set(topKey, new DataView(arrayBuffers[0]));
        continue;
      }
      const topVal = model.get(topKey);
      if (topVal == null) continue;
      putBuffers(topVal, localPaths, arrayBuffers);
    }
  }

  // (3) Build sub-model registry from _myst_submodels and attach a widget_manager
  // stub. Pre-create every proxy so the cross-widget registry is fully populated
  // before any widget on the page calls into it.
  const submodels =
    (typeof model.get === "function" && model.get("_myst_submodels")) || {};
  const cache = new Map<string, any>();
  const reg = registry();
  for (const [id, entry] of Object.entries<any>(submodels)) {
    const proxy: any = new SubModel(entry.state, entry.buffers);
    proxy.model_id = id;
    proxy.name = entry.model_name;
    proxy.module = entry.model_module;
    cache.set(id, proxy);
    reg.register(proxy, keysForState(entry.state, id));
  }
  const wm: any = {
    get_model: (id: string) => {
      if (cache.has(id)) return Promise.resolve(cache.get(id));
      const entry: any = (submodels as any)[id];
      if (!entry) return Promise.reject(new Error("[myst-shim] unknown sub-model: " + id));
      const proxy: any = new SubModel(entry.state, entry.buffers);
      proxy.widget_manager = wm;
      proxy.model_id = id;
      proxy.name = entry.model_name;
      proxy.module = entry.model_module;
      cache.set(id, proxy);
      reg.register(proxy, keysForState(entry.state, id));
      return Promise.resolve(proxy);
    },
    resolve_url: (url: string) => Promise.resolve(url),
  };
  for (const proxy of cache.values()) proxy.widget_manager = wm;
  // MystAnyModel exposes widget_manager as a getter-only prototype property that
  // throws. Install a data property on the instance to shadow it.
  Object.defineProperty(model, "widget_manager", {
    configurable: true,
    writable: true,
    value: wm,
  });

  // (4) Register the root model in the cross-widget registry.
  const rootId = (typeof model.get === "function" && model.get("_myst_root_id")) || null;
  const widgetIdField = (typeof model.get === "function" && model.get("widget_id")) || null;
  const anywidgetIdField =
    (typeof model.get === "function" && model.get("_myst_anywidget_id")) || null;
  reg.register(
    model,
    keysForState({ widget_id: widgetIdField, _anywidget_id: anywidgetIdField }, rootId),
  );
  reg.installLinks((typeof model.get === "function" && model.get("_myst_links")) || []);
}
