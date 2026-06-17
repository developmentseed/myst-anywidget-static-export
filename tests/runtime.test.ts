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

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

import { Emitter } from "../src/runtime/emitter.js";
import { SubModel } from "../src/runtime/submodel.js";
import { registry, setupModel } from "../src/runtime/registry.js";

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

describe("registry: same-id model mirroring", () => {
  // Without a kernel there is no single canonical model: one logical widget can
  // appear as several objects (a rendered root + SubModel proxies created for
  // cross-widget references), and `reg.get(id)` returns whichever registered
  // first — an order that differs between localhost and a CDN. These tests pin
  // that registering a second object under the same UUID keeps the two in sync,
  // so a slider drag (a write to one) is visible to a FilterBinder reading the
  // other, regardless of resolution order.
  beforeAll(() => {
    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).document = (globalThis as any).document || {
      baseURI: "test://runtime",
    };
  });
  afterAll(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });
  beforeEach(() => {
    // Force a fresh registry for each test (registry() caches per baseURI).
    (globalThis as any).window.__myst_anywidget_hosts = undefined;
  });

  // Minimal MystAnyModel stand-in: identity via `_myst_root_id`, plus get/set/on.
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

  it("mirrors writes both ways between two SubModels sharing a model_id", () => {
    const reg = registry();
    const a = new SubModel({ low: 4, high: 10 }, []);
    a.model_id = "uuid-1";
    const b = new SubModel({ low: 4, high: 10 }, []);
    b.model_id = "uuid-1";

    reg.register(a, ["uuid-1"]);
    reg.register(b, ["uuid-1"]); // collision on the UUID → mirror

    expect(reg.get("uuid-1")).toBe(a); // first registration wins the key

    // A write to the object reg.get() does NOT return must still be visible.
    b.set("low", 6);
    expect(a.get("low")).toBe(6);

    // And the reverse direction.
    a.set("high", 7);
    expect(b.get("high")).toBe(7);
  });

  it("mirrors a rendered root model and a referenced SubModel proxy", () => {
    const reg = registry();
    const sub = new SubModel({ low: 4, high: 10 }, []);
    sub.model_id = "uuid-2";
    const root = fakeRootModel({ _myst_root_id: "uuid-2", low: 4, high: 10 });

    reg.register(sub, ["uuid-2"]); // submodel registers first (the CDN order)
    reg.register(root, ["uuid-2"]); // root arrives second → mirror

    // The binder would resolve `sub` (it won the key); a drag writes to `root`.
    root.set("high", 4.5);
    expect(sub.get("high")).toBe(4.5);
  });

  it("does NOT mirror distinct instances colliding on a shared alias key", () => {
    const reg = registry();
    const a = new SubModel({ value: 1 }, []);
    a.model_id = "uuid-a";
    const b = new SubModel({ value: 2 }, []);
    b.model_id = "uuid-b";

    // Two different layers share a class-path / type alias but are NOT the same
    // logical model — they must stay independent.
    const alias = "lonboard._layer.ScatterplotLayer";
    reg.register(a, [alias]);
    reg.register(b, [alias]); // collision on alias, but UUIDs differ → no mirror

    a.set("value", 100);
    expect(b.get("value")).toBe(2);
  });

  it("converges without looping when both objects are written", () => {
    const reg = registry();
    const a = new SubModel({ n: 0 }, []);
    a.model_id = "uuid-3";
    const b = new SubModel({ n: 0 }, []);
    b.model_id = "uuid-3";
    reg.register(a, ["uuid-3"]);
    reg.register(b, ["uuid-3"]);

    // A no-op-valued write (value already equal) must not recurse or throw.
    expect(() => a.set("n", 0)).not.toThrow();
    a.set("n", 5);
    expect(b.get("n")).toBe(5);
    expect(a.get("n")).toBe(5);
  });
});
