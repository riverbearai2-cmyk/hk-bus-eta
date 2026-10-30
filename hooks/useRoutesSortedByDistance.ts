"use client";

import { useState, useEffect } from "react";
import type { BusRoute } from "@/types/bus";
import { haversineDistance } from "@/utils/geo";

// Cache: route file key -> min distance to a given user location
// Keyed by `${region}-${code}-${route_seq}-${userLat.toFixed(3)}-${userLng.toFixed(3)}`
const distCache = new Map<string, number>();

async function gmbRouteMinDist(
  region: string,
  code: string,
  routeSeq: number,
  userLat: number,
  userLng: number
): Promise<number> {
  const key = `${region}-${code}-${routeSeq}-${userLat.toFixed(3)}-${userLng.toFixed(3)}`;
  if (distCache.has(key)) return distCache.get(key)!;
  try {
    const res = await fetch(`gmb/routes/${region}-${code}.json`);
    if (!res.ok) return Infinity;
    const data = await res.json();
    let min = Infinity;
    for (const d of data.directions || []) {
      if (d.route_seq !== routeSeq) continue;
      for (const s of d.stops || []) {
        if (s.lat != null && s.lng != null) {
          const dist = haversineDistance(userLat, userLng, s.lat, s.lng);
          if (dist < min) min = dist;
        }
      }
    }
    distCache.set(key, min);
    return min;
  } catch {
    return Infinity;
  }
}

/**
 * Sort route search results by distance to user (for GMB routes with bundled
 * stop coords). Other operators keep their relative order after nearby GMB.
 * This solves duplicate route numbers across regions (e.g. KMB 43C in Tsing Yi
 * vs GMB 43C in Tuen Mun) — the nearby one appears first.
 */
export function useRoutesSortedByDistance(
  routes: BusRoute[],
  userLat: number,
  userLng: number
): BusRoute[] {
  const [sorted, setSorted] = useState<BusRoute[]>(routes);
  const hasLoc = !!userLat && !!userLng;

  useEffect(() => {
    if (!hasLoc || routes.length === 0) {
      setSorted(routes);
      return;
    }
    let cancelled = false;
    (async () => {
      const withDist = await Promise.all(
        routes.map(async (r) => {
          if (r.operator === "GMB" && r.gmb) {
            const d = await gmbRouteMinDist(
              r.gmb.region,
              r.gmb.code,
              r.gmb.route_seq,
              userLat,
              userLng
            );
            return { r, d };
          }
          return { r, d: Infinity };
        })
      );
      if (cancelled) return;
      // Stable sort: nearby GMB first (by distance), others keep original order
      const decorated = withDist.map((x, i) => ({ ...x, i }));
      decorated.sort((a, b) => {
        if (a.d !== b.d) return a.d - b.d;
        return a.i - b.i;
      });
      setSorted(decorated.map((x) => x.r));
    })();
    return () => {
      cancelled = true;
    };
  }, [routes, userLat, userLng, hasLoc]);

  return hasLoc ? sorted : routes;
}
