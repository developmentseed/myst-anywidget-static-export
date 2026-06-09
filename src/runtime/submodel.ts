// Lightweight model proxy used for sub-models referenced via IPY_MODEL_<id>.
// Implements the subset of WidgetModel that anywidget-style frontends use.

import { applyBuffers, BufferRecord } from "./buffers.js";
import { Emitter } from "./emitter.js";

export class SubModel {
  private _state: any;
  private _events: Emitter;
  private __widget_manager: any;
  // Identity fields attached by the registry/setup code.
  model_id?: string;
  name?: string;
  module?: string;

  constructor(state: any, buffers: BufferRecord[]) {
    // Deep-clone state, then splice DataViews in at buffer paths.
    this._state = JSON.parse(JSON.stringify(state || {}));
    applyBuffers(this._state, buffers || []);
    this._events = new Emitter();
  }

  get(key: string): any {
    return this._state[key];
  }

  set(key: string, value: any): void {
    this._state[key] = value;
    this._events.emit("change:" + key);
    this._events.emit("change");
  }

  on(event: string, fn: (detail: any, extra?: any) => void): this {
    this._events.on(event, fn);
    return this;
  }

  off(event: string, fn: Function): this {
    this._events.off(event, fn);
    return this;
  }

  save_changes(): void {}
  send(): void {}

  // Comm mock: fire this proxy's "msg:custom" listeners locally, simulating an
  // inbound kernel->frontend custom message. See setupModel for the root-model
  // equivalent. Dispatches locally only — there is no kernel.
  receiveCustomMessage(content: any, buffers?: any): void {
    this._events.emit("msg:custom", content, buffers);
  }

  get widget_manager(): any {
    return this.__widget_manager;
  }
  set widget_manager(wm: any) {
    this.__widget_manager = wm;
  }
}
