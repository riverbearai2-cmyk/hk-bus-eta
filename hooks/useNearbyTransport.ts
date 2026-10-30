"use client";

import { useState, useEffect } from "react";
import type { BusStop } from "@/types/bus";

export interface NearbyTransport {
  kind: "bus" | "mtr" | "lrt" | "gmb" | "nlb" | "ferry";
  id: string;
  nameTc: string;
  nameEn: string;
  lat: number;
  lng: number;
  dist: number;
  // For bus: BusStop object; for mtr/lrt: metadata for ETA fetching
  busStop?: BusStop;
  // Extra stop records merged into this card (same name + same pole in the
  // source data, e.g. KMB registering one physical stop twice)
  mergedStops?: BusStop[];
  mtrt?: { line: string; sta: string; lineTc: string; lineEn: string };
  lrt?: { stationId: string; tc: string; en: string };
  gmb?: { route_id: number; route_seq: number; stop_seq: number; code: string; dest_tc: string; dest_en: string; stop_id: number };
  nlb?: { routeId: number; routeNo: string; stopId: number; dest_tc: string; dest_en: string };
  ferry?: import("@/types/bus").FerryMeta & { dest_tc: string; dest_en: string; from_tc: string; from_en: string };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Load all nearby transport (bus stops + MTR stations + Light Rail stops)
 * within 800m, sorted by distance. NO limit — show everything.
 */
export function useNearbyTransport(
  userLat: number,
  userLng: number,
  busStops: BusStop[],
  maxDist: number = 800
): NearbyTransport[] {
  const [items, setItems] = useState<NearbyTransport[]>([]);

  useEffect(() => {
    if (!userLat || !userLng) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const all: NearbyTransport[] = [];

      // Bus stops (within 800m). Source data registers the same stop
      // area many times (same name, different internal ids - e.g. the six
      // 友愛邨 records TM161-TM166 spread over ~27m, or TM136/TM137 vs
      // TM730/TM731 at 屯門官立中學 38.1m apart). Same name within 40m
      // (the same radius the app already uses for cross-operator stop
      // matching) merges into ONE card; the card queries every merged
      // record so no route is lost, and identical departures dedupe.
      // 2026-10-24: raised from 5m - the 5m rule left look-alike cards
      // (友愛邨 TM162/TM164, 9.6m apart) showing the same bus twice.
      // 2026-10-25 (RB3 approved): "X總站" counts as the same place as
      // "X" (e.g. 屯門市中心總站 vs 屯門市中心, 7.2m apart, sharing one CTB
      // stop) - strip a trailing 總站 before comparing. Territory-wide
      // simulation: only 15 fewer cards across 26 same-place groups.
      const baseName = (n: string) => {
        const s = n
          .replace(/\s*\([A-Z]{1,3}\d+\)\s*$/, "")
          .trim()
          .replace(/總站$/, "")
          .trim();
        return s || n;
      };
      for (const s of busStops) {
        if (s.lat == null || s.lng == null) continue;
        const dist = haversine(userLat, userLng, s.lat, s.lng);
        if (dist > maxDist) continue;
        const dup = all.find(
          (it) =>
            it.kind === "bus" &&
            baseName(it.nameTc) === baseName(s.nameTc) &&
            haversine(it.lat, it.lng, s.lat, s.lng) <= 40
        );
        if (dup) {
          dup.mergedStops = [...(dup.mergedStops || []), s];
          // Keep the card anchored on the record nearest the user, so
          // distance and Google Maps navigation point at the right pole.
          if (dist < dup.dist) {
            dup.dist = dist;
            dup.lat = s.lat;
            dup.lng = s.lng;
          }
          continue;
        }
        all.push({
          kind: "bus",
          id: s.id,
          nameTc: s.nameTc,
          nameEn: s.nameEn,
          lat: s.lat,
          lng: s.lng,
          dist,
          busStop: s,
        });
      }

      // MTR train stations (within 800m)
      try {
        const res = await fetch("mtr/train-stations.json");
        const data = await res.json();
        const lineNames: Record<string, string> = {
          AEL: "機場快綫", TCL: "東涌綫", TML: "屯馬綫", TKL: "將軍澳綫",
          EAL: "東鐵綫", SIL: "南港島綫", TWL: "荃灣綫", ISL: "港島綫",
          KTL: "觀塘綫", DRL: "迪士尼綫",
        };
        for (const [lineCode, stations] of Object.entries(data.lines) as [string, any[]][]) {
          if (lineCode === "" || !Array.isArray(stations)) continue;
          for (const st of stations) {
            if (st.lat == null || st.lng == null) continue;
            const dist = haversine(userLat, userLng, st.lat, st.lng);
            if (dist <= maxDist) {
              all.push({
                kind: "mtr",
                id: `mtr-${lineCode}-${st.code}`,
                nameTc: `${st.tc}站`,
                nameEn: `${st.en} Station`,
                lat: st.lat,
                lng: st.lng,
                dist,
                mtrt: {
                  line: lineCode,
                  sta: st.code,
                  lineTc: lineNames[lineCode] || lineCode,
                  lineEn: lineCode,
                },
              });
            }
          }
        }
      } catch {}

      // Light Rail stops (within 800m)
      try {
        const res = await fetch("mtr/light-rail.json");
        const data = await res.json();
        for (const s of Object.values(data.stops) as any[]) {
          if (s.lat == null || s.lng == null) continue;
          const dist = haversine(userLat, userLng, s.lat, s.lng);
          if (dist <= maxDist) {
            all.push({
              kind: "lrt",
              id: `lrt-${s.id}`,
              nameTc: `${s.tc}站`,
              nameEn: `${s.en} Stop`,
              lat: s.lat,
              lng: s.lng,
              dist,
              lrt: { stationId: s.id, tc: s.tc, en: s.en },
            });
          }
        }
      } catch {}

      // GMB stops (within 800m) - direct from bundled data
      try {
        const res = await fetch("gmb/all-stops.json");
        const gmbStops = await res.json();
        for (const s of gmbStops) {
          if (s.lat == null || s.lng == null) continue;
          const dist = haversine(userLat, userLng, s.lat, s.lng);
          if (dist <= maxDist) {
            for (const r of (s.routes || [])) {
              all.push({
                kind: "gmb",
                id: `gmb-${s.stop_id}-${r.route_id}-${r.route_seq}`,
                nameTc: `${s.name_tc || s.name_en}`,
                nameEn: s.name_en || "",
                lat: s.lat,
                lng: s.lng,
                dist,
                gmb: {
                  route_id: r.route_id,
                  route_seq: r.route_seq,
                  stop_seq: r.stop_seq,
                  code: r.code,
                  dest_tc: r.dest_tc,
                  dest_en: r.dest_en,
                  stop_id: parseInt(s.stop_id),
                },
              });
            }
          }
        }
      } catch {}

      // NLB stops (within range) - direct from bundled data
      try {
        const res = await fetch("nlb/all-stops.json");
        const nlbStops = await res.json();
        for (const s of nlbStops) {
          if (s.lat == null || s.lng == null) continue;
          const dist = haversine(userLat, userLng, s.lat, s.lng);
          if (dist <= maxDist) {
            for (const r of (s.routes || [])) {
              all.push({
                kind: "nlb",
                id: `${s.stopKey}-${r.routeId}`,
                nameTc: `${s.name_tc || s.name_en}`,
                nameEn: s.name_en || "",
                lat: s.lat,
                lng: s.lng,
                dist,
                nlb: {
                  routeId: r.routeId,
                  routeNo: r.routeNo,
                  stopId: r.stopId,
                  dest_tc: r.dest_tc,
                  dest_en: r.dest_en,
                },
              });
            }
          }
        }
      } catch {}

      // Ferry piers (within range) - bundled piers + routes
      try {
        const [pRes, rRes] = await Promise.all([
          fetch("ferry/piers.json"),
          fetch("ferry/routes.json"),
        ]);
        const piers = await pRes.json();
        const froutes = await rRes.json();
        const pierById = new Map(piers.map((p: any) => [p.id, p]));
        for (const r of froutes) {
          const pier: any = pierById.get(r.fromPier);
          if (!pier) continue;
          const dist = haversine(userLat, userLng, pier.lat, pier.lng);
          if (dist <= maxDist) {
            all.push({
              kind: "ferry",
              id: `ferry-${r.key}`,
              nameTc: pier.nameTc,
              nameEn: pier.nameEn,
              lat: pier.lat,
              lng: pier.lng,
              dist,
              ferry: {
                company: r.company,
                code: r.code,
                dir: r.dir,
                starDir: r.starDir,
                fromPier: r.fromPier,
                toPier: r.toPier,
                dest_tc: r.destTc,
                dest_en: r.destEn,
                from_tc: r.fromTc,
                from_en: r.fromEn,
              },
            });
          }
        }
      } catch {}

      if (!cancelled) {
        // Sort by distance, no limit
        all.sort((a, b) => a.dist - b.dist);
        setItems(all);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userLat, userLng, busStops, maxDist]);

  return items;
}
