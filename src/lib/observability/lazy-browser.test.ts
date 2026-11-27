import { describe, expect, it, vi } from "vitest";

import { MAX_BUFFERED, startLazySentry, type LazySdk } from "./lazy-browser";

function fakeWindow(readyState: DocumentReadyState = "complete") {
  const events = new EventTarget();
  return {
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events)),
    dispatch: (event: Event) => events.dispatchEvent(event),
    document: { readyState },
  };
}

const runNow = (start: () => void) => {
  start();
};

function errorEvent(error: unknown): Event {
  return Object.assign(new Event("error"), { error, message: String(error) });
}

function fakeSdk() {
  const sdk = {
    init: vi.fn<(options: unknown) => void>(),
    captureException: vi.fn<(error: unknown) => void>(),
  };
  return sdk satisfies LazySdk;
}

describe("startLazySentry", () => {
  it("does nothing without a DSN: no import and no listeners", async () => {
    const target = fakeWindow();
    const load = vi.fn<() => Promise<LazySdk>>();
    await startLazySentry({ options: { enabled: false }, load, target, whenIdle: runNow });
    expect(load).not.toHaveBeenCalled();
    expect(target.addEventListener).not.toHaveBeenCalled();
  });

  it("waits for the load event and an idle moment before importing the SDK", async () => {
    const target = fakeWindow("loading");
    const sdk = fakeSdk();
    const load = vi.fn(() => Promise.resolve(sdk));
    let idle: (() => void) | undefined;
    const started = startLazySentry({
      options: { enabled: true, dsn: "https://k@o0.ingest.example/1" },
      load,
      target,
      whenIdle: (start) => (idle = start),
    });

    expect(load).not.toHaveBeenCalled();
    target.dispatch(new Event("load"));
    expect(load).not.toHaveBeenCalled();
    idle?.();
    await started;
    expect(load).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith({ enabled: true, dsn: "https://k@o0.ingest.example/1" });
  });

  it("reports errors and rejections from before the SDK loaded, then stops buffering", async () => {
    const target = fakeWindow();
    const sdk = fakeSdk();
    let idle: (() => void) | undefined;
    const started = startLazySentry({
      options: { enabled: true },
      load: () => Promise.resolve(sdk),
      target,
      whenIdle: (start) => (idle = start),
    });

    const early = new Error("early");
    target.dispatch(errorEvent(early));
    target.dispatch(Object.assign(new Event("unhandledrejection"), { reason: "rejected" }));
    idle?.();
    await started;

    expect(sdk.captureException.mock.calls).toEqual([[early], ["rejected"]]);
    target.dispatch(errorEvent(new Error("late")));
    expect(sdk.captureException).toHaveBeenCalledTimes(2);
    expect(target.removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(target.removeEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
  });

  it(`keeps at most ${String(MAX_BUFFERED)} early errors`, async () => {
    const target = fakeWindow();
    const sdk = fakeSdk();
    let idle: (() => void) | undefined;
    const started = startLazySentry({
      options: { enabled: true },
      load: () => Promise.resolve(sdk),
      target,
      whenIdle: (start) => (idle = start),
    });
    for (let i = 0; i < MAX_BUFFERED + 5; i += 1) target.dispatch(errorEvent(new Error(`e${String(i)}`)));
    idle?.();
    await started;
    expect(sdk.captureException).toHaveBeenCalledTimes(MAX_BUFFERED);
  });

  it("carries on quietly if the SDK chunk can't be loaded", async () => {
    const target = fakeWindow();
    await expect(
      startLazySentry({
        options: { enabled: true },
        load: () => Promise.reject(new Error("chunk load failed")),
        target,
        whenIdle: runNow,
      }),
    ).resolves.toBeUndefined();
    expect(target.removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
