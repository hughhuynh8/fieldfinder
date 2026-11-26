import { describe, expect, it, vi } from "vitest";

import { createLogger, type LogLevel } from "@/lib/log";

import { createEnumerationDetector, tileOf, WINDOW_MS } from "./enumeration";

const IP = "203.0.113.9";

function setup(threshold = 3, maxClients = 100) {
  let clock = 1_000_000;
  const lines: { level: LogLevel; line: string }[] = [];
  const report = vi.fn();
  const detector = createEnumerationDetector({
    secret: () => "unit-test-secret-unit-test-secret-0123",
    now: () => clock,
    logger: createLogger((level, line) => lines.push({ level, line }), "debug"),
    report,
    threshold,
    maxClients,
  });
  return { detector, lines, report, advance: (ms: number) => (clock += ms) };
}

// One search in each of `n` distinct ~10 km tiles around Melbourne.
const walk = (record: (lat: number, lng: number) => void, n: number, start = 0) => {
  for (let i = start; i < start + n; i++) record(-37.85 + (i % 10) * 0.1, 144.85 + Math.floor(i / 10) * 0.1);
};

describe("search enumeration detector", () => {
  it("puts nearby searches in one tile and distant ones in different tiles", () => {
    expect(tileOf(-37.8136, 144.9631)).toBe(tileOf(-37.84, 144.99));
    expect(tileOf(-37.8136, 144.9631)).not.toBe(tileOf(-37.7, 144.9631));
  });

  it("stays quiet for a person searching a few places, however many times", () => {
    const { detector, report } = setup();
    for (let i = 0; i < 50; i++)
      walk((lat, lng) => {
        detector.record(IP, lat, lng);
      }, 3);
    expect(report).not.toHaveBeenCalled();
  });

  it("raises one warning per window when a client covers more tiles than the threshold", () => {
    const { detector, lines, report } = setup();
    walk((lat, lng) => {
      detector.record(IP, lat, lng);
    }, 10);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("search.enumeration_suspected", {
      client: expect.stringMatching(/^[0-9a-f]{16}$/) as unknown,
      distinctTiles: 4,
      windowMinutes: 10,
      threshold: 3,
    });
    const warnings = lines.filter((l) => l.line.includes("search.enumeration_suspected"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe("warn");
  });

  it("never logs or reports the IP address or a coordinate", () => {
    const { detector, lines, report } = setup();
    walk((lat, lng) => {
      detector.record(IP, lat, lng);
    }, 10);
    const out = JSON.stringify([lines, report.mock.calls]);
    expect(out).not.toContain(IP);
    expect(out).not.toMatch(/-37\.\d|144\.\d/);
  });

  it("starts a new window after 10 minutes, and can warn again in it", () => {
    const { detector, report, advance } = setup();
    walk((lat, lng) => {
      detector.record(IP, lat, lng);
    }, 3);
    advance(WINDOW_MS);
    walk(
      (lat, lng) => {
        detector.record(IP, lat, lng);
      },
      3,
      3,
    );
    expect(report).not.toHaveBeenCalled(); // 3 + 3 tiles, but never more than 3 in one window
    walk(
      (lat, lng) => {
        detector.record(IP, lat, lng);
      },
      1,
      6,
    );
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("counts an IPv6 /64 as one client", () => {
    const { detector, report } = setup();
    for (let i = 0; i < 4; i++) detector.record(`2001:db8:1:2::${String(i + 1)}`, -37.85 + i * 0.1, 144.95);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a trusted client IP", () => {
    const { detector, report } = setup();
    walk((lat, lng) => {
      detector.record(null, lat, lng);
    }, 10);
    expect(report).not.toHaveBeenCalled();
    expect(detector.size()).toBe(0);
  });

  it("keeps memory bounded by dropping the oldest client", () => {
    const { detector } = setup(3, 50);
    for (let i = 0; i < 200; i++) detector.record(`198.51.100.${String(i % 250)}`, -37.8, 144.9);
    expect(detector.size()).toBe(50);
  });

  it("never throws into the search, even if the key can't be made", () => {
    const lines: string[] = [];
    const detector = createEnumerationDetector({
      secret: () => {
        throw new Error("SEARCH_CURSOR_SECRET is missing");
      },
      logger: createLogger((_level, line) => lines.push(line), "debug"),
      report: vi.fn(),
    });
    expect(() => {
      detector.record(IP, -37.8, 144.9);
    }).not.toThrow();
    expect(lines.join("\n")).toContain("search.enumeration_detector_failed");
  });
});
