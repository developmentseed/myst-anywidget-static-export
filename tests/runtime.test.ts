// Runtime (browser-side) unit tests for the comm-mock delivery path.
//
// These pin the single behaviour the cross-widget "custom message" feature
// rests on: a `msg:custom` listener registered on a model receives BOTH the
// content and the buffers when `receiveCustomMessage(content, buffers)` is
// called locally — the kernel-free stand-in for an inbound comm message that
// drives e.g. lonboard's `Map.fly_to`. The consumer (manywidgets) tests the
// integration against a hand-written fake model; these tests pin the real
// `Emitter` / `SubModel` / `setupModel` contract that fake is mirroring, so the
// two repos can't silently drift.
//
// We import the TypeScript runtime source directly (resolved through Vite), the
// same way tests/transform.test.ts imports the plugin. No DOM environment is
// needed: Node provides EventTarget/CustomEvent, and the few `window`/`document`
// touch-points in registry() are stubbed below.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

import { Emitter } from "../src/runtime/emitter.js";
import { SubModel } from "../src/runtime/submodel.js";
import { setupModel } from "../src/runtime/registry.js";

describe("Emitter: second positional arg (comm buffers)", () => {
  it("delivers both detail and extra to a listener", () => {
    const e = new Emitter();
    const got: Array<[any, any]> = [];
    e.on("msg:custom", (detail, extra) => got.push([detail, extra]));

    const extra = [new DataView(new ArrayBuffer(2))];
    e.emit("msg:custom", { type: "fly-to" }, extra);

    expect(got).toHaveLength(1);
    expect(got[0][0]).toEqual({ type: "fly-to" });
    expect(got[0][1]).toBe(extra); // same reference flows through, not a copy
  });

  it("passes undefined extra when none is given (e.g. change:* events)", () => {
    const e = new Emitter();
    let captured: any = "unset";
    e.on("change:x", (_detail, extra) => {
      captured = extra;
    });
    e.emit("change:x", 42);
    expect(captured).toBeUndefined();
  });

  it("off detaches the listener", () => {
    const e = new Emitter();
    let n = 0;
    const fn = () => n++;
    e.on("evt", fn);
    e.off("evt", fn);
    e.emit("evt");
    expect(n).toBe(0);
  });

  it("carries extra and isolates a throwing listener on the non-EventTarget fallback", () => {
    const savedET = (globalThis as any).EventTarget;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Force the Map-based fallback by hiding EventTarget at construction time.
      (globalThis as any).EventTarget = undefined;
      const e = new Emitter();
      const got: Array<[any, any]> = [];
      e.on("msg:custom", () => {
        throw new Error("boom");
      });
      e.on("msg:custom", (detail, extra) => got.push([detail, extra]));

      const extra = [7];
      e.emit("msg:custom", { z: 1 }, extra);

      expect(got).toHaveLength(1); // second listener still ran despite the first throwing
      expect(got[0][1]).toBe(extra);
    } finally {
      (globalThis as any).EventTarget = savedET;
      errSpy.mockRestore();
    }
  });
});

describe("SubModel.receiveCustomMessage (sub-model proxy path)", () => {
  it("delivers content and buffers to msg:custom listeners", () => {
    const m = new SubModel({}, []);
    const got: Array<[any, any]> = [];
    m.on("msg:custom", (content, buffers) => got.push([content, buffers]));

    const bufs = [new DataView(new ArrayBuffer(4))];
    m.receiveCustomMessage({ type: "fly-to", zoom: 10 }, bufs);

    expect(got).toHaveLength(1);
    expect(got[0][0]).toEqual({ type: "fly-to", zoom: 10 });
    expect(got[0][1]).toBe(bufs);
  });

  it("passes the empty-array buffers the consumer defaults to", () => {
    const m = new SubModel({}, []);
    let captured: any = "unset";
    m.on("msg:custom", (_content, buffers) => {
      captured = buffers;
    });
    m.receiveCustomMessage({ type: "fly-to" }, []);
    expect(captured).toEqual([]);
  });

  it("does not fire a removed listener", () => {
    const m = new SubModel({}, []);
    let n = 0;
    const fn = () => n++;
    m.on("msg:custom", fn);
    m.off("msg:custom", fn);
    m.receiveCustomMessage({}, []);
    expect(n).toBe(0);
  });

  it("does not fire non-msg:custom listeners", () => {
    const m = new SubModel({}, []);
    let other = 0;
    m.on("change:value", () => other++);
    m.receiveCustomMessage({}, []);
    expect(other).toBe(0);
  });
});

describe("setupModel.receiveCustomMessage (root model path)", () => {
  beforeAll(() => {
    // registry() reads window.__myst_anywidget_hosts and document.baseURI; stub
    // the minimum so it runs under the node test environment (no jsdom).
    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).document = (globalThis as any).document || {
      baseURI: "test://runtime",
    };
  });
  afterAll(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  // Minimal stand-in for MystAnyModel: a native `on` (which setupModel wraps)
  // plus `get`/`set`. receiveCustomMessage dispatches from setupModel's own
  // active-listener tracking, so the native `on` need not actually fire.
  function fakeRootModel(state: Record<string, any> = {}): any {
    const data: Record<string, any> = { ...state };
    return {
      get: (k: string) => data[k],
      set(k: string, v: any) {
        data[k] = v;
      },
      on() {
        return this;
      },
    };
  }

  it("delivers content and buffers to msg:custom listeners", () => {
    const model = fakeRootModel();
    setupModel(model);

    const got: Array<[any, any]> = [];
    model.on("msg:custom", (content: any, buffers: any) => got.push([content, buffers]));

    const bufs = [new DataView(new ArrayBuffer(1))];
    model.receiveCustomMessage({ type: "fly-to" }, bufs);

    expect(got).toHaveLength(1);
    expect(got[0][0]).toEqual({ type: "fly-to" });
    expect(got[0][1]).toBe(bufs);
  });

  it("a listener registered during dispatch does not receive the in-flight message", () => {
    const model = fakeRootModel();
    setupModel(model);

    const lateCalls: any[] = [];
    model.on("msg:custom", () => {
      // Registering mid-dispatch must not retroactively deliver the current
      // message — the active set is snapshotted before iteration.
      model.on("msg:custom", (c: any) => lateCalls.push(c));
    });

    model.receiveCustomMessage({ first: true });
    expect(lateCalls).toHaveLength(0);

    model.receiveCustomMessage({ second: true });
    expect(lateCalls).toEqual([{ second: true }]);
  });

  it("a throwing listener does not abort delivery to the others (fan-out safety)", () => {
    const model = fakeRootModel();
    setupModel(model);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let reached = false;
    model.on("msg:custom", () => {
      throw new Error("boom");
    });
    model.on("msg:custom", () => {
      reached = true;
    });

    expect(() => model.receiveCustomMessage({})).not.toThrow();
    expect(reached).toBe(true);
    errSpy.mockRestore();
  });
});
