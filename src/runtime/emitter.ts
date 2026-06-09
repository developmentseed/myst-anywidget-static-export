// A small event bus. Prefers a real EventTarget when available (so events behave
// like DOM events), with a Map-based fallback for non-DOM environments.

function eventTarget(): EventTarget | null {
  if (typeof EventTarget === "function") return new EventTarget();
  return null;
}

function eventDetail(ev: any): any {
  return ev && "detail" in ev ? ev.detail : undefined;
}

// Backbone/ipywidgets accept space-separated event names ("change:a change:b").
// Split so each name is registered/unregistered individually.
function splitEvents(event: string): string[] {
  return String(event).split(/\s+/).filter(Boolean);
}

export class Emitter {
  private _target: EventTarget | null;
  private _listeners: Map<string, Map<Function, (ev: any) => void>>;

  constructor() {
    this._target = eventTarget();
    this._listeners = new Map();
  }

  private _listenersFor(event: string) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Map());
    return this._listeners.get(event)!;
  }

  on(event: string, fn: ((detail: any, extra?: any) => void) | undefined): void {
    if (!fn) return;
    for (const name of splitEvents(event)) this._onOne(name, fn);
  }

  off(event: string, fn: Function): void {
    for (const name of splitEvents(event)) this._offOne(name, fn);
  }

  private _onOne(event: string, fn: (detail: any, extra?: any) => void): void {
    if (this._target) {
      const listeners = this._listenersFor(event);
      const wrapped = (ev: any) => {
        fn(eventDetail(ev), ev && ev.__extra);
      };
      listeners.set(fn, wrapped);
      this._target.addEventListener(event, wrapped as EventListener);
      return;
    }
    this._listenersFor(event).set(fn, fn as (ev: any) => void);
  }

  private _offOne(event: string, fn: Function): void {
    const listeners = this._listeners.get(event);
    if (!listeners) return;
    const wrapped = listeners.get(fn);
    if (this._target && wrapped) {
      this._target.removeEventListener(event, wrapped as EventListener);
    }
    listeners.delete(fn);
    if (listeners.size === 0) this._listeners.delete(event);
  }

  emit(event: string, detail?: any, extra?: any): void {
    if (this._target) {
      const ev =
        typeof CustomEvent === "function"
          ? new CustomEvent(event, { detail })
          : Object.assign(new Event(event), { detail });
      // Carry a second positional arg (e.g. comm buffers) alongside detail.
      if (extra !== undefined) (ev as any).__extra = extra;
      this._target.dispatchEvent(ev);
      return;
    }
    const listeners = this._listeners.get(event);
    if (!listeners) return;
    for (const fn of Array.from(listeners.values())) {
      try {
        (fn as (detail: any, extra?: any) => void)(detail, extra);
      } catch (e) {
        console.error("[myst-host] listener error", e);
      }
    }
  }
}
