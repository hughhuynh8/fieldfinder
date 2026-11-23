import "server-only";

import { createHmac } from "node:crypto";

import { log as defaultLogger, type Logger } from "@/lib/log";
import { reportSignal, type SignalReporter } from "@/lib/observability/report";
import { clientSubject } from "@/lib/rate-limit/client-ip";

// Search-enumeration heuristic (PR 4.4, spec §6 "anomaly alerts for systematic tile enumeration").
//
// A person searches a handful of places; a scraper walks the map. For each client (IPv4 address or
// IPv6 /64, keyed by an HMAC so no IP is held), this counts the distinct coarse tiles (0.1°, roughly
// 10 km) it searched within a 10-minute window, and raises one warning per window when the count
// passes a threshold.
//
// Kept in memory per server instance, by decision (no Redis, D5): nothing about tiles or coordinates
// is stored durably, and the search path gains no database write. The cost is that a scraper spread
// across instances is undercounted, so this is an alert for people to look at, never a block.
// Thresholds are hypotheses to tune against real traffic, like the edge rate limits.

export const TILE_DEGREES = 0.1;
export const WINDOW_MS = 10 * 60 * 1000;
export const DISTINCT_TILE_THRESHOLD = 25;
/** Upper bound on clients tracked per instance; the oldest window is dropped first. */
export const MAX_TRACKED_CLIENTS = 5000;

interface Window {
  startedAt: number;
  tiles: Set<string>;
  alerted: boolean;
}

export interface EnumerationDetector {
  /** Records one search by `ip` centred on (lat, lng). Never throws. */
  record(ip: string | null, lat: number, lng: number): void;
  /** Clients currently tracked (for tests). */
  size(): number;
}

export interface DetectorOptions {
  secret: () => string;
  now?: () => number;
  logger?: Logger;
  report?: SignalReporter;
  threshold?: number;
  maxClients?: number;
}

export function tileOf(lat: number, lng: number): string {
  return `${String(Math.floor(lat / TILE_DEGREES))}:${String(Math.floor(lng / TILE_DEGREES))}`;
}

export function createEnumerationDetector(options: DetectorOptions): EnumerationDetector {
  const now = options.now ?? Date.now;
  const logger = options.logger ?? defaultLogger;
  const report = options.report ?? reportSignal;
  const threshold = options.threshold ?? DISTINCT_TILE_THRESHOLD;
  const maxClients = options.maxClients ?? MAX_TRACKED_CLIENTS;
  const windows = new Map<string, Window>();

  const keyFor = (ip: string) =>
    createHmac("sha256", options.secret())
      .update(`fieldfinder.enumeration.v1\n${clientSubject(ip)}`)
      .digest("hex")
      .slice(0, 16);

  return {
    record(ip, lat, lng) {
      // Off the Vercel network there's no trustworthy client IP (client-ip.ts); count nothing.
      if (ip === null) return;
      try {
        const at = now();
        const key = keyFor(ip);
        let window = windows.get(key);
        if (window === undefined || at - window.startedAt >= WINDOW_MS) {
          windows.delete(key);
          if (windows.size >= maxClients) {
            const oldest = windows.keys().next().value;
            if (oldest !== undefined) windows.delete(oldest);
          }
          window = { startedAt: at, tiles: new Set(), alerted: false };
          windows.set(key, window);
        }
        // Once alerted, the window has said all it will; stop growing the set.
        if (window.alerted) return;
        window.tiles.add(tileOf(lat, lng));
        if (window.tiles.size > threshold) {
          window.alerted = true;
          const fields = {
            client: key,
            distinctTiles: window.tiles.size,
            windowMinutes: WINDOW_MS / 60_000,
            threshold,
          };
          logger.warn("search.enumeration_suspected", fields);
          report("search.enumeration_suspected", fields);
          window.tiles.clear();
        }
      } catch (error) {
        // Monitoring must never break a search.
        logger.error("search.enumeration_detector_failed", { error });
      }
    },
    size: () => windows.size,
  };
}
