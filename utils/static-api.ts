"use client";

// Client-side data layer for the static (GitHub Pages) build.
// Talks directly to the official open-data endpoints — both KMB and
// Citybus send `Access-Control-Allow-Origin: *`, so no server proxy is needed.
// Logic mirrors the old /api/* route handlers one-to-one.

import {
  normalizeKMBStop,
  normalizeCTBStop,
  normalizeETAFromKMB,
  normalizeETAFromCTB,
} from "@/utils/api";
import { mergeStops } from "@/utils/geo";
import type { BusStop, BusRoute, ETA, RouteStopSeq } from "@/types/bus";

// ---- simple in-memory caches (session scope) ----
let stopsCache: BusStop[] | null = null;
let stopsCacheAt = 0;
let routesCache: { kmb: any[]; ctb: any[] } | null = null;
let routesCacheAt = 0;
let gmbIndexCache: any[] | null = null;
let mtrIndexCache: any[] | null = null;
let mtrTrainCache: any | null = null;
let nlbRoutesCache: any[] | null = null;
let ferryRoutesCache: any[] | null = null;
let ferryPiersCache: any[] | null = null;
let starTtCache: any | null = null;
let holidaysCache: string[] | null = null;

async function loadFerryRoutes(): Promise<any[]> {
  if (!ferryRoutesCache) {
    ferryRoutesCache = await plainFetch("ferry/routes.json").catch(() => []);
  }
  return ferryRoutesCache || [];
}
async function loadFerryPiers(): Promise<any[]> {
  if (!ferryPiersCache) {
    ferryPiersCache = await plainFetch("ferry/piers.json").catch(() => []);
  }
  return ferryPiersCache || [];
}
let lrtCache: any | null = null;
const STOPS_TTL = 24 * 3600 * 1000;
const ROUTES_TTL = 24 * 3600 * 1000;

const GMB_PROXY =
  "https://hengfuk-gmb-proxy-riverbearai2-1543.vercel.app/api/gmb-proxy?path=";

// MTR Next Train API has CORS * (verified 2026-10-18) — call directly, no proxy needed.
// (Earlier HEAD-request test was misleading; GET returns Access-Control-Allow-Origin: *)
const MTR_TRAIN_API = "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php";

async function plainFetch(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// NLB (New Lantao Bus) API has CORS * (verified 2026-10-21) — call directly.
const NLB_BASE = "https://rt.data.gov.hk/v2/transport/nlb";
const KMB_BASE = "https://data.etabus.gov.hk/v1/transport/kmb";
const CTB_BASE = "https://rt.data.gov.hk/v2/transport/citybus";

const STOPS_LS_KEY = "hkbuseta.stops.v1";

export async function getStops(): Promise<BusStop[]> {
  if (stopsCache && Date.now() - stopsCacheAt < STOPS_TTL) return stopsCache;
  // 1) localStorage (instant on repeat visits)
  try {
    const raw = localStorage.getItem(STOPS_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 1000) {
        stopsCache = parsed;
        stopsCacheAt = Date.now();
        return stopsCache;
      }
    }
  } catch {
    /* ignore */
  }
  // 2) bundled static file (fast CDN, no API dependency)
  try {
    const bundled = await plainFetch("stops.json");
    if (Array.isArray(bundled) && bundled.length > 1000) {
      stopsCache = bundled as BusStop[];
      stopsCacheAt = Date.now();
      try {
        localStorage.setItem(STOPS_LS_KEY, JSON.stringify(bundled));
      } catch {
        /* quota — ignore */
      }
      return stopsCache;
    }
  } catch {
    /* fall through to live APIs */
  }
  // 3) live APIs (fallback)
  const [kmbRaw, ctbRaw] = await Promise.all([
    plainFetch(`${KMB_BASE}/stop`).then((j) => j.data || []).catch(() => []),
    plainFetch(`${CTB_BASE}/stop`).then((j) => j.data || []).catch(() => []),
  ]);
  const kmb = kmbRaw.map(normalizeKMBStop);
  const ctb = ctbRaw.map(normalizeCTBStop);
  stopsCache = mergeStops(kmb, ctb, 25);
  stopsCacheAt = Date.now();
  return stopsCache;
}

async function getRawRoutes() {
  if (routesCache && Date.now() - routesCacheAt < ROUTES_TTL) return routesCache;
  const [kmbRaw, ctbRaw] = await Promise.all([
    plainFetch(`${KMB_BASE}/route`)
      .then((j) => j.data || [])
      .catch(async () => {
        // Fallback to bundled KMB route list if live API unreachable
        try {
          const bundled = await plainFetch("kmb-routes.json");
          return Array.isArray(bundled) ? bundled : [];
        } catch {
          return [];
        }
      }),
    plainFetch(`${CTB_BASE}/route/CTB`)
      .then((j) => (Array.isArray(j.data) ? j.data : [j.data]))
      .catch(() => []),
  ]);
  routesCache = { kmb: kmbRaw, ctb: ctbRaw };
  routesCacheAt = Date.now();
  return routesCache;
}

// Bundled list of CTB one-way routes (from full API audit 2026-10-19):
// most are morning-peak / race-day / cemetery specials that genuinely run one way.
let ctbOnewayCache: { outbound_only: string[]; inbound_only: string[] } | null = null;
async function getCtbOneway() {
  if (ctbOnewayCache) return ctbOnewayCache;
  try {
    const j = await plainFetch("ctb/oneway.json");
    ctbOnewayCache = {
      outbound_only: j.outbound_only || [],
      inbound_only: j.inbound_only || [],
    };
  } catch {
    ctbOnewayCache = { outbound_only: [], inbound_only: [] };
  }
  return ctbOnewayCache;
}

export async function searchRoutes(query: string): Promise<BusRoute[]> {
  const q = query.trim().toUpperCase();
  const { kmb: kmbRaw, ctb: ctbRaw } = await getRawRoutes();
  const ctbOneway = await getCtbOneway();
  const routes: BusRoute[] = [];

  for (const r of kmbRaw) {
    if (
      q &&
      !r.route.toUpperCase().includes(q) &&
      !r.dest_en.toUpperCase().includes(q) &&
      !r.orig_en.toUpperCase().includes(q) &&
      !(r.dest_tc || "").includes(query.trim()) &&
      !(r.orig_tc || "").includes(query.trim())
    ) {
      continue;
    }
    routes.push({
      id: `KMB-${r.route}-${r.bound}-${r.service_type}`,
      operator: "KMB",
      route: r.route,
      serviceType: r.service_type,
      bound: r.bound as "I" | "O",
      originEn: r.orig_en,
      originTc: r.orig_tc,
      destEn: r.dest_en,
      destTc: r.dest_tc,
      directionLabel: r.bound === "I" ? "Inbound" : "Outbound",
    });
  }

  for (const r of ctbRaw) {
    if (
      q &&
      !r.route.toUpperCase().includes(q) &&
      !r.dest_en.toUpperCase().includes(q) &&
      !r.orig_en.toUpperCase().includes(q) &&
      !(r.dest_tc || "").includes(query.trim()) &&
      !(r.orig_tc || "").includes(query.trim())
    ) {
      continue;
    }
    // CTB: two cards per route (outbound + inbound), like KMB's I/O cards.
    // One-way special routes get a single card for their valid direction.
    const isObOnly = ctbOneway.outbound_only.includes(r.route);
    const isIbOnly = ctbOneway.inbound_only.includes(r.route);
    if (!isIbOnly) {
      routes.push({
        id: `CTB-${r.route}-outbound`,
        operator: "CTB",
        route: r.route,
        bound: "outbound",
        originEn: r.orig_en,
        originTc: r.orig_tc,
        destEn: r.dest_en,
        destTc: r.dest_tc,
        directionLabel: `往 ${r.dest_tc}`,
      });
    }
    if (!isObOnly) {
      routes.push({
        id: `CTB-${r.route}-inbound`,
        operator: "CTB",
        route: r.route,
        bound: "inbound",
        originEn: r.dest_en,
        originTc: r.dest_tc,
        destEn: r.orig_en,
        destTc: r.orig_tc,
        directionLabel: `往 ${r.orig_tc}`,
      });
    }
  }

  routes.sort((a, b) => {
    // Boost LRT route-number matches (e.g. "輕鐵 505號") to the top
    // when the query is a pure number matching an LRT route
    const aIsLrtRoute = a.id.startsWith("LRT-R-");
    const bIsLrtRoute = b.id.startsWith("LRT-R-");
    if (aIsLrtRoute && !bIsLrtRoute) return -1;
    if (!aIsLrtRoute && bIsLrtRoute) return 1;
    const numA = parseInt(a.route.replace(/\D/g, "")) || 9999;
    const numB = parseInt(b.route.replace(/\D/g, "")) || 9999;
    if (numA !== numB) return numA - numB;
    return a.route.localeCompare(b.route);
  });

  // Green minibus (bundled static index; official API has no CORS)
  try {
    if (!gmbIndexCache) {
      gmbIndexCache = await plainFetch("gmb/index.json").catch(() => []);
    }
    // Also load stop search index for "routes passing through" search
    let gmbStopIndex: Record<string, string[]> | null = null;
    try {
      gmbStopIndex = await plainFetch("gmb/stop-search-index.json").catch(() => null);
    } catch {}
    // Find GMB routes whose STOPS contain the query (e.g. "大樹下")
    const gmbStopMatched = new Set<string>(); // "region|code|route_seq"
    if (q && gmbStopIndex) {
      const qTrim = query.trim();
      for (const [stopName, routeKeys] of Object.entries(gmbStopIndex)) {
        if (stopName.includes(qTrim)) {
          for (const key of routeKeys as string[]) {
            const parts = key.split("|");
            if (parts.length >= 3) {
              gmbStopMatched.add(`${parts[0]}|${parts[1]}|${parts[2]}`);
            }
          }
          if (gmbStopMatched.size >= 20) break; // Limit
        }
      }
    }
    for (const g of gmbIndexCache || []) {
      const stopKey = `${g.region}|${g.code}|${g.route_seq}`;
      const matchedByStop = gmbStopMatched.has(stopKey);
      if (
        q &&
        !matchedByStop &&
        !g.code.toUpperCase().includes(q) &&
        !(g.dest_tc || "").includes(query.trim()) &&
        !(g.orig_tc || "").includes(query.trim()) &&
        !(g.dest_en || "").toUpperCase().includes(q) &&
        !(g.orig_en || "").toUpperCase().includes(q)
      ) {
        continue;
      }
      routes.push({
        id: `GMB-${g.region}-${g.code}-${g.route_seq}`,
        operator: "GMB",
        route: g.code,
        originEn: g.orig_en || "",
        originTc: g.orig_tc || "",
        destEn: g.dest_en || "",
        destTc: g.dest_tc || "",
        directionLabel: g.route_seq === 1 ? "去程" : "回程",
        gmb: {
          region: g.region,
          code: g.code,
          route_id: g.route_id,
          route_seq: g.route_seq,
        },
      });
    }
  } catch {
    /* GMB index optional */
  }

  // MTR Bus (bundled static index from opendata.mtr.com.hk)
  try {
    if (!mtrIndexCache) {
      mtrIndexCache = await plainFetch("mtr/index.json").catch(() => []);
    }
    for (const m of mtrIndexCache || []) {
      if (
        q &&
        !m.route.toUpperCase().includes(q) &&
        !(m.dest_tc || "").includes(query.trim()) &&
        !(m.orig_tc || "").includes(query.trim()) &&
        !(m.dest_en || "").toUpperCase().includes(q) &&
        !(m.orig_en || "").toUpperCase().includes(q)
      ) {
        continue;
      }
      routes.push({
        id: `MTR-${m.route}-${m.dir}`,
        operator: "MTR",
        route: m.route,
        bound: m.dir as "I" | "O",
        originEn: m.origin_en || "",
        originTc: m.origin_tc || "",
        destEn: m.dest_en || "",
        destTc: m.dest_tc || "",
        directionLabel: m.dir === "I" ? "Inbound" : "Outbound",
      });
    }
  } catch {
    /* MTR index optional */
  }

  // Ferries (Sun Ferry / HKKF / Star Ferry; bundled index, live ETA APIs)
  try {
    const ferryRoutes = await loadFerryRoutes();
    for (const fr of ferryRoutes) {
      const op =
        fr.company === "SUN" ? "SUNFERRY" : fr.company === "HKKF" ? "HKKF" : "STARFERRY";
      if (
        q &&
        String(fr.code).toUpperCase() !== q &&
        !(fr.destTc || "").includes(query.trim()) &&
        !(fr.fromTc || "").includes(query.trim()) &&
        !(fr.destEn || "").toUpperCase().includes(q) &&
        !(fr.fromEn || "").toUpperCase().includes(q) &&
        !"渡輪".includes(query.trim()) &&
        !"碼頭".includes(query.trim())
      ) {
        continue;
      }
      routes.push({
        id: `${op}-${fr.key}`,
        operator: op as any,
        route: `${fr.fromTc} → ${fr.destTc}`,
        originEn: fr.fromEn || "",
        originTc: fr.fromTc || "",
        destEn: fr.destEn || "",
        destTc: fr.destTc || "",
        directionLabel: `往 ${fr.destTc}`,
        ferry: {
          company: fr.company,
          code: fr.code,
          dir: fr.dir,
          starDir: fr.starDir,
          fromPier: fr.fromPier,
          toPier: fr.toPier,
        },
      });
    }
  } catch {
    /* ferry index optional */
  }

  // New Lantao Bus (bundled route index; stops/ETA live from official API)
  try {
    if (!nlbRoutesCache) {
      nlbRoutesCache = await plainFetch("nlb/routes.json").catch(() => []);
    }
    for (const n of nlbRoutesCache || []) {
      if (
        q &&
        !String(n.routeNo).toUpperCase().includes(q) &&
        !(n.dest_tc || "").includes(query.trim()) &&
        !(n.orig_tc || "").includes(query.trim()) &&
        !(n.dest_en || "").toUpperCase().includes(q) &&
        !(n.orig_en || "").toUpperCase().includes(q)
      ) {
        continue;
      }
      routes.push({
        id: `NLB-${n.routeId}`,
        operator: "NLB",
        route: n.routeNo,
        originEn: n.orig_en || "",
        originTc: n.orig_tc || "",
        destEn: n.dest_en || "",
        destTc: n.dest_tc || "",
        directionLabel: `往 ${n.dest_tc}`,
        nlb: { routeId: n.routeId },
      });
    }
  } catch {
    /* NLB index optional */
  }

  // MTR Trains (heavy rail, bundled static from opendata.mtr.com.hk)
  // Search by station name -> returns stations (each station is a "stop")
  try {
    if (!mtrTrainCache) {
      mtrTrainCache = await plainFetch("mtr/train-stations.json").catch(() => null);
    }
    if (mtrTrainCache?.lines) {
      const lineNames: Record<string, { tc: string; en: string }> = {
        AEL: { tc: "機場快綫", en: "Airport Express" },
        TCL: { tc: "東涌綫", en: "Tung Chung Line" },
        TML: { tc: "屯馬綫", en: "Tuen Ma Line" },
        TKL: { tc: "將軍澳綫", en: "Tseung Kwan O Line" },
        EAL: { tc: "東鐵綫", en: "East Rail Line" },
        SIL: { tc: "南港島綫", en: "South Island Line" },
        TWL: { tc: "荃灣綫", en: "Tsuen Wan Line" },
        ISL: { tc: "港島綫", en: "Island Line" },
        KTL: { tc: "觀塘綫", en: "Kwun Tong Line" },
        DRL: { tc: "迪士尼綫", en: "Disneyland Resort Line" },
      };
      for (const [lineCode, stations] of Object.entries(mtrTrainCache.lines)) {
        if (lineCode === "" || !Array.isArray(stations)) continue;
        const ln = lineNames[lineCode] || { tc: lineCode, en: lineCode };
        for (const s of stations as any[]) {
          // Handle "站" suffix: user may search "屯門站" but data has "屯門"
          const qNoStation = query.trim().replace(/站$/, "");
          const staMatch =
            !q ||
            (s.tc || "").includes(query.trim()) ||
            (s.tc || "").includes(qNoStation) ||
            qNoStation === s.tc ||
            (s.en || "").toUpperCase().includes(q) ||
            ln.tc.includes(query.trim()) ||
            ln.en.toUpperCase().includes(q);
          if (!staMatch) continue;
          routes.push({
            id: `MTRT-${lineCode}-${s.code}`,
            operator: "MTRT",
            route: `${s.tc}站`,
            originEn: s.en,
            originTc: s.tc,
            destEn: ln.en,
            destTc: ln.tc,
            directionLabel: `${ln.tc} · ${s.tc}`,
            mtrt: { line: lineCode, lineTc: ln.tc, lineEn: ln.en, sta: s.code, staTc: s.tc, staEn: s.en },
          });
        }
      }
    }
  } catch {
    /* MTR train optional */
  }

  // Bus stop name search (KMB stops from bundled stops.json)
  // e.g. search "友愛" finds stops with 友愛 in the name
  try {
    if (q) {
      const stopsList = await plainFetch("stops.json").catch(() => []);
      const qTrim = query.trim();
      let count = 0;
      for (const s of (stopsList as any[]) || []) {
        if (count >= 10) break; // Limit to 10 stops
        const nameTc = s.nameTc || s.name_tc || "";
        const nameEn = s.nameEn || s.name_en || "";
        if (nameTc.includes(qTrim) || nameEn.toUpperCase().includes(q)) {
          routes.push({
            id: `STOP-${s.id}`,
            operator: "KMB",
            route: nameTc,
            originTc: nameTc,
            originEn: nameEn,
            destTc: "巴士站",
            destEn: "Bus Stop",
            directionLabel: `車站 · ${nameEn}`,
            // Mark as stop result with full stop data
            isStopResult: true,
            stopData: s,
          } as any);
          count++;
        }
      }
    }
  } catch {
    /* stop search optional */
  }

  // Light Rail (68 stops, bundled with coords from Wikipedia)
  // Search by stop name OR route number (e.g. "505")
  try {
    if (!lrtCache) {
      lrtCache = await plainFetch("mtr/light-rail.json").catch(() => null);
    }
    if (lrtCache) {
      // Check if query matches a Light Rail route number (e.g. "505" matches "505-1", "505-2")
      const routeNum = query.trim();
      const lrtRoutes = lrtCache.routes || {};
      // Find all directions for this route number
      const matchingKeys = Object.keys(lrtRoutes).filter(k => k === routeNum || k.startsWith(routeNum + "-"));
      if (matchingKeys.length > 0) {
        // Query is an LRT route number - use the first direction's stops
        const stops = lrtRoutes[matchingKeys[0]] as any[];
        // Add a route header entry first
        const firstStop = stops[0];
        const lastStop = stops[stops.length - 1];
        routes.push({
          id: `LRT-R-${routeNum}`,
          operator: "LRT",
          route: `輕鐵 ${routeNum}號`,
          originTc: firstStop?.tc || "",
          originEn: firstStop?.en || "",
          destTc: lastStop?.tc || "",
          destEn: lastStop?.en || "",
          directionLabel: `輕鐵路線 · ${stops.length}個站`,
          lrt: { stationId: firstStop?.sid || "", tc: firstStop?.tc || "", en: firstStop?.en || "" },
          lrtRoute: routeNum,
        });
      }
      // Also search by stop name (existing)
      if (lrtCache?.stops) {
        const qNoStationLrt = query.trim().replace(/站$/, "");
        for (const s of Object.values(lrtCache.stops) as any[]) {
          const match =
            !q ||
            (s.tc || "").includes(query.trim()) ||
            (s.tc || "").includes(qNoStationLrt) ||
            qNoStationLrt === s.tc ||
            (s.en || "").toUpperCase().includes(q);
          if (!match) continue;
          routes.push({
            id: `LRT-${s.id}`,
            operator: "LRT",
            route: `${s.tc}站`,
            originEn: s.en,
            originTc: s.tc,
            destEn: "Light Rail",
            destTc: "輕鐵",
            directionLabel: `輕鐵 · ${s.tc}`,
            lrt: { stationId: s.id, tc: s.tc, en: s.en },
          });
        }
      }
    }
  } catch {
    /* LRT optional */
  }

  return q ? routes : routes.slice(0, 100);
}

export async function getRouteStops(
  route: string,
  operator: "KMB" | "CTB" | "LWB" | "GMB" | "MTR" | "NLB" | "SUNFERRY" | "HKKF" | "STARFERRY" | null,
  bound: string = "O",
  gmbMeta?: { region: string; code: string; route_id: number; route_seq: number },
  nlbMeta?: { routeId: number },
  ferryMeta?: import("@/types/bus").FerryMeta
): Promise<RouteStopSeq[]> {
  // Ferries: a route is pier -> pier (2 stops), from the bundled pier index
  if (ferryMeta) {
    const piers = await loadFerryPiers();
    const from = piers.find((p: any) => p.id === ferryMeta.fromPier);
    const to = piers.find((p: any) => p.id === ferryMeta.toPier);
    const out: RouteStopSeq[] = [];
    if (from) {
      out.push({ stop: from.id, seq: 1, lat: from.lat, lng: from.lng, name_tc: from.nameTc, name_en: from.nameEn });
    }
    if (to) {
      out.push({ stop: to.id, seq: 2, lat: to.lat, lng: to.lng, name_tc: to.nameTc, name_en: to.nameEn });
    }
    return out;
  }
  // New Lantao Bus: live from official API (routeId identifies the direction)
  if (operator === "NLB" && nlbMeta) {
    try {
      const j = await plainFetch(
        `${NLB_BASE}/stop.php?action=list&routeId=${nlbMeta.routeId}`
      );
      return (j.stops || []).map((s: any) => ({
        stop: String(s.stopId),
        seq: Number(s.stopId),
        lat: s.latitude != null ? Number(s.latitude) : undefined,
        lng: s.longitude != null ? Number(s.longitude) : undefined,
        name_tc: s.stopName_c,
        name_en: s.stopName_e,
      }));
    } catch {
      return [];
    }
  }
  // MTR Bus: bundled per-route JSON from opendata.mtr.com.hk (has coords + names)
  if (operator === "MTR") {
    const dir = bound === "I" || bound === "inbound" ? "I" : "O";
    try {
      const j = await plainFetch(`mtr/routes/${encodeURIComponent(route)}-${dir}.json`);
      return (j.stops || []).map((s: any) => ({
        stop: String(s.stop_id),
        seq: s.seq,
        lat: s.lat ?? undefined,
        lng: s.lng ?? undefined,
        name_tc: s.name_tc,
        name_en: s.name_en,
      }));
    } catch {
      return [];
    }
  }
  // Green minibus: bundled per-route JSON (has coords + names)
  if (operator === "GMB" && gmbMeta) {
    const { region, code, route_seq } = gmbMeta;
    try {
      const j = await plainFetch(
        `gmb/routes/${encodeURIComponent(region)}-${encodeURIComponent(code)}.json`
      );
      const dir =
        (j.directions || []).find((d: any) => d.route_seq === route_seq) ||
        j.directions?.[0];
      if (!dir) return [];
      return (dir.stops || []).map((s: any) => ({
        stop: String(s.stop_id),
        seq: s.seq,
        lat: s.lat ?? undefined,
        lng: s.lng ?? undefined,
        name_tc: s.name_tc,
        name_en: s.name_en,
      }));
    } catch {
      return [];
    }
  }
  if (operator === "CTB") {
    const dir = bound === "I" || bound === "inbound" ? "inbound" : "outbound";
    const res = await plainFetch(`${CTB_BASE}/route-stop/CTB/${route}/${dir}`).catch(
      () => ({ data: [] })
    );
    return (res.data || []).map((r: any) => ({ stop: r.stop, seq: r.seq }));
  }
  // KMB: API needs outbound/inbound (fixed from upstream O/I bug)
  const dir = bound === "I" || bound === "inbound" ? "inbound" : "outbound";
  for (const st of ["1", "2"]) {
    const res = await plainFetch(`${KMB_BASE}/route-stop/${route}/${dir}/${st}`).catch(
      () => ({ data: [] })
    );
    const list = (res.data || []).map((r: any) => ({ stop: r.stop, seq: r.seq }));
    if (list.length > 0) return list;
  }
  return [];
}

export interface ETAQuery {
  stopId?: string;
  operator?: "KMB" | "CTB" | "GMB" | "MTR" | "MTRT" | "LRT" | "NLB" | "SUNFERRY" | "HKKF" | "STARFERRY" | null;
  originalId?: string;
  routes?: string; // comma separated, for CTB
  gmb?: {
    route_id: number;
    route_seq: number;
    stop_seq: number;
    code: string;
    dest_tc: string;
    dest_en: string;
  };
  mtr?: {
    routeName: string; // e.g. "K52"
    stopId: string; // e.g. "K52-nD010"
    dest_tc: string;
    dest_en: string;
  };
  mtrt?: {
    line: string; // e.g. "TML"
    sta: string; // e.g. "TUM"
    lineTc: string;
    lineEn: string;
  };
  lrt?: {
    stationId: string; // e.g. "920"
    tc: string;
    en: string;
  };
  nlb?: {
    routeId: number; // NLB API routeId (one per direction)
    stopId: number; // NLB API stopId (= stop sequence on that route)
    routeNo: string;
    dest_tc: string;
    dest_en: string;
  };
  ferry?: import("@/types/bus").FerryMeta & {
    dest_tc: string;
    dest_en: string;
    from_tc: string;
    from_en: string;
    pierSeq?: number; // 1 = departures from origin pier; 2 = reverse direction
  };
}

function cleanKmbId(stopId: string, originalId?: string) {
  const kmbId = originalId || stopId.replace(/^kmb-/, "").replace(/^merged-.*-/, "");
  return kmbId.includes("-") ? kmbId.split("-").pop()! : kmbId;
}


type FerryETAQuery = import("@/types/bus").FerryMeta & {
  dest_tc: string;
  dest_en: string;
  from_tc: string;
  from_en: string;
  pierSeq?: number;
};

function ferryOperator(company: string): "SUNFERRY" | "HKKF" | "STARFERRY" {
  return company === "SUN" ? "SUNFERRY" : company === "HKKF" ? "HKKF" : "STARFERRY";
}

// Next-departure ETAs for a ferry direction. pierSeq 2 means "departures from
// the destination pier" (reverse direction), used by hearts saved at that pier.
export async function getFerryETAs(ferry: FerryETAQuery): Promise<ETA[]> {
  let meta: FerryETAQuery = ferry;
  if (ferry.pierSeq === 2) {
    try {
      const all = await loadFerryRoutes();
      const rev = all.find(
        (r: any) => r.company === ferry.company && r.fromPier === ferry.toPier && r.toPier === ferry.fromPier
      );
      if (rev) {
        meta = {
          company: rev.company,
          code: rev.code,
          dir: rev.dir,
          starDir: rev.starDir,
          fromPier: rev.fromPier,
          toPier: rev.toPier,
          dest_tc: ferry.from_tc,
          dest_en: ferry.from_en,
          from_tc: ferry.dest_tc,
          from_en: ferry.dest_en,
        };
      }
    } catch {}
  }
  const op = ferryOperator(meta.company);
  const now = new Date();

  if (meta.company === "SUN") {
    try {
      const res = await fetch(
        `https://www.sunferry.com.hk/eta/?route=${encodeURIComponent(meta.code)}`
      ).then((r) => r.json());
      const row = (res?.data || [])[0];
      if (!row || !row.depart_time) return [];
      const [h, m] = String(row.depart_time).split(":").map((x: string) => parseInt(x, 10));
      const dep = new Date(now);
      dep.setHours(h, m, 0, 0);
      let mins = Math.round((dep.getTime() - now.getTime()) / 60000);
      // APIs return the current/last sailing even after departure;
      // more than 5 min gone = no longer boardable -> hide
      if (mins < -5) return [];
      if (mins < 0) mins = 0;
      return [
        {
          id: `sun-${meta.code}`,
          operator: op,
          route: meta.code,
          destEn: meta.dest_en,
          destTc: meta.dest_tc,
          eta: dep.toISOString(),
          etaMinutes: mins,
          remarkEn: row.rmk_en || undefined,
          remarkTc: row.rmk_tc || undefined,
          sequence: 1,
          isRealtime: true,
        },
      ];
    } catch {
      return [];
    }
  }

  if (meta.company === "HKKF") {
    try {
      const res = await fetch(
        `https://www.hkkfeta.com/opendata/eta/${meta.code}/${meta.dir || "outbound"}`
      ).then((r) => r.json());
      const row = (res?.data || [])[0];
      if (!row || !row.session_time) return [];
      const [h, m] = String(row.session_time).split(":").map((x: string) => parseInt(x, 10));
      const dep = new Date(now);
      dep.setHours(h, m, 0, 0);
      let mins = Math.round((dep.getTime() - now.getTime()) / 60000);
      if (mins < -5) return [];
      if (mins < 0) mins = 0;
      return [
        {
          id: `hkkf-${meta.code}-${meta.dir}`,
          operator: op,
          route: meta.code,
          destEn: meta.dest_en,
          destTc: meta.dest_tc,
          eta: row.ETA || dep.toISOString(),
          etaMinutes: mins,
          sequence: 1,
          isRealtime: true,
        },
      ];
    } catch {
      return [];
    }
  }

  // Star Ferry: official data is a frequency table, not exact sailings.
  // Show the current headway honestly; never invent a departure time.
  try {
    if (!starTtCache) {
      starTtCache = await plainFetch("ferry/star-timetable.json").catch(() => ({}));
    }
    if (!holidaysCache) {
      holidaysCache = await plainFetch("ferry/hk-holidays.json").catch(() => []);
    }
    const table = (starTtCache || {})[meta.starDir || ""];
    if (!table) return [];
    const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const isPH = (holidaysCache || []).includes(ymd);
    const dow = now.getDay();
    const matches = (key: string) => {
      switch (key) {
        case "weekday": return dow >= 1 && dow <= 5 && !isPH;
        case "monsat": return dow >= 1 && dow <= 6 && !isPH;
        case "sat": return dow === 6 && !isPH;
        case "sunph": return dow === 0 || isPH;
        case "satsunph": return dow === 6 || dow === 0 || isPH;
        default: return false;
      }
    };
    const nowHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    for (const [key, periods] of Object.entries(table)) {
      if (!matches(key)) continue;
      for (const p of periods as any[]) {
        if (nowHM >= p.start && nowHM < p.end) {
          const freq =
            p.freqMin === p.freqMax ? `${p.freqMin}` : `${p.freqMin}–${p.freqMax}`;
          return [
            {
              id: `star-${meta.code}`,
              operator: op,
              route: meta.code,
              destEn: meta.dest_en,
              destTc: meta.dest_tc,
              eta: null,
              etaMinutes: null,
              remarkEn: `Every ${freq} mins (timetable)`,
              remarkTc: `約 ${freq} 分鐘一班（時間表）`,
              sequence: 1,
              isRealtime: false,
            },
          ];
        }
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function getETAs(query: ETAQuery): Promise<ETA[]> {
  const { stopId, operator, originalId, routes } = query;
  if (!stopId && !originalId && !(operator === "GMB" && query.gmb) && !(operator === "MTR" && query.mtr) && !(operator === "NLB" && query.nlb) && !query.ferry) return [];
  if (query.ferry) {
    return getFerryETAs(query.ferry);
  }
  let etas: ETA[] = [];

  // MTR Bus via rt.data.gov.hk (has CORS *, POST API)
  if (operator === "MTR" && query.mtr) {
    const { routeName, stopId: mtrStopId, dest_tc, dest_en } = query.mtr;
    try {
      const res = await fetch("https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "zh", routeName }),
      }).then((r) => r.json());
      const stop = (res.busStop || []).find((s: any) => s.busStopId === mtrStopId);
      if (stop) {
        etas = (stop.bus || []).slice(0, 3).map((b: any, i: number) => {
          const secs = parseInt(b.departureTimeInSecond || "0", 10);
          const mins = secs >= 108000 ? null : Math.max(0, Math.round(secs / 60));
          return {
            id: `mtr-${routeName}-${mtrStopId}-${i}`,
            operator: "MTR" as const,
            route: routeName,
            destEn: dest_en,
            destTc: dest_tc,
            eta: null,
            etaMinutes: mins,
            remarkEn: b.departureTimeText || undefined,
            remarkTc: b.departureTimeText || undefined,
            sequence: i + 1,
            isRealtime: b.isScheduled !== "1",
          };
        });
      }
    } catch {
      etas = [];
    }
    return etas;
  }

  // MTR Trains via direct API (has CORS *, verified 2026-10-18)
  // Returns next 4 trains per direction (UP/DOWN)
  if (operator === "MTRT" && query.mtrt) {
    const { line, sta, lineTc, lineEn } = query.mtrt;
    try {
      const res = await fetch(
        `${MTR_TRAIN_API}?line=${line}&sta=${sta}&lang=TC`
      ).then((r) => r.json());
      if (res.status === 1 && res.data) {
        const key = `${line}-${sta}`;
        const stationData = res.data[key];
        if (stationData) {
          const trains: ETA[] = [];
          // UP and DOWN directions
          for (const dir of ["UP", "DOWN"]) {
            const list = stationData[dir] || [];
            for (const t of list.slice(0, 4)) {
              if (t.valid !== "Y") continue;
              // time is "yyyy-MM-dd HH:mm:ss", curr_time is similar
              // Calculate minutes from curr_time
              const curr = new Date(stationData.curr_time.replace(" ", "T"));
              const arr = new Date(t.time.replace(" ", "T"));
              const mins = Math.max(0, Math.round((arr.getTime() - curr.getTime()) / 60000));
              // dest is station code, need to map to name
              // For now use the code, UI can map via train-stations.json
              trains.push({
                id: `mtrt-${line}-${sta}-${dir}-${t.seq}`,
                operator: "MTRT" as const,
                route: lineTc,
                destEn: t.dest, // station code, mapped in UI
                destTc: t.dest, // station code, mapped in UI
                eta: t.time,
                etaMinutes: mins,
                remarkEn: `Plat ${t.plat}`,
                remarkTc: `${t.plat}號月台`,
                sequence: trains.length + 1,
                isRealtime: true,
              });
            }
          }
          etas = trains;
        }
      }
    } catch {
      etas = [];
    }
    return etas;
  }

  // Light Rail via direct API (has CORS *, verified 2026-10-18)
  if (operator === "LRT" && query.lrt) {
    const { stationId, tc, en } = query.lrt;
    try {
      const res = await fetch(
        `https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule?station_id=${stationId}`
      ).then((r) => r.json());
      // status: 1 = normal, 2 = no service (e.g. night)
      if (res.status === 1 && res.platform_list) {
        const trains: ETA[] = [];
        for (const plat of res.platform_list) {
          for (const route of plat.route_list || []) {
            // time_ch/time_en: e.g. "2分鐘" / "2 mins", or "-" if no data
            const timeStr = route.time_ch || route.time_en || "-";
            let mins: number | null = null;
            const m = timeStr.match(/(\d+)/);
            if (m) mins = parseInt(m[1], 10);
            // "即將到站" or "Arriving" -> 0
            if (timeStr.includes("即將") || timeStr.toLowerCase().includes("arriving")) mins = 0;
            trains.push({
              id: `lrt-${stationId}-${plat.platform_id}-${route.route_no}`,
              operator: "LRT" as const,
              route: `${route.route_no}號`,
              destEn: route.dest_en || "",
              destTc: route.dest_ch || "",
              eta: null,
              etaMinutes: mins,
              remarkEn: route.time_en || undefined,
              remarkTc: route.time_ch || undefined,
              sequence: trains.length + 1,
              isRealtime: true,
            });
          }
        }
        etas = trains;
      }
    } catch {
      etas = [];
    }
    return etas;
  }

  // New Lantao Bus via official API (has CORS *, verified 2026-10-21)
  // Note: NLB ETAs are timetable/historical-data estimates, not live GPS.
  if (operator === "NLB" && query.nlb) {
    const { routeId, stopId: nlbStopId, routeNo, dest_tc, dest_en } = query.nlb;
    try {
      const res = await fetch(
        `${NLB_BASE}/stop.php?action=estimatedArrivals&routeId=${routeId}&stopId=${nlbStopId}&language=zh`
      ).then((r) => r.json());
      const list = res?.estimatedArrivals || [];
      const now = Date.now();
      etas = list
        .filter((e: any) => e.estimatedArrivalTime)
        .map((e: any, i: number) => {
          const t = new Date(String(e.estimatedArrivalTime).replace(" ", "T")).getTime();
          const mins = Math.max(0, Math.round((t - now) / 60000));
          return {
            id: `nlb-${routeId}-${nlbStopId}-${i}`,
            operator: "NLB" as const,
            route: routeNo,
            destEn: dest_en,
            destTc: dest_tc,
            eta: e.estimatedArrivalTime,
            etaMinutes: mins,
            remarkEn: e.routeVariantName || undefined,
            remarkTc: e.routeVariantName || undefined,
            sequence: i + 1,
            isRealtime: String(e.noGPS) === "1",
          };
        });
    } catch {
      etas = [];
    }
    return etas;
  }

  // Green minibus via the dedicated CORS proxy (official API has no CORS)
  if (operator === "GMB" && query.gmb) {
    const { route_id, route_seq, stop_seq, code, dest_tc, dest_en } = query.gmb;
    try {
      const j = await plainFetch(
        `${GMB_PROXY}eta/route-stop/${route_id}/${route_seq}/${stop_seq}`
      );
      const list = j?.data?.eta || [];
      etas = list.map((e: any, i: number) => ({
        id: `gmb-${route_id}-${route_seq}-${stop_seq}-${e.eta_seq ?? i}`,
        operator: "GMB" as const,
        route: code,
        destEn: dest_en,
        destTc: dest_tc,
        eta: e.timestamp || null,
        etaMinutes: typeof e.diff === "number" ? Math.max(0, e.diff) : null,
        remarkEn: e.remarks_en || undefined,
        remarkTc: e.remarks_tc || undefined,
        sequence: e.eta_seq ?? i + 1,
        isRealtime: !!e.remarks_en && e.remarks_en !== "Scheduled",
      }));
    } catch {
      etas = [];
    }
    return etas;
  }

  if (operator === "KMB" || !operator) {
    const cleanId = cleanKmbId(stopId!, originalId);
    try {
      const raw = await plainFetch(`${KMB_BASE}/stop-eta/${cleanId}`).then(
        (j) => j.data || []
      );
      etas = raw.map(normalizeETAFromKMB);
    } catch {
      /* keep empty */
    }
  }

  if ((operator === "CTB" || operator === null) && routes) {
    const ctbId = (originalId || stopId!.replace(/^ctb-/, "").split("-").pop()!);
    const list = routes.split(",").filter(Boolean);
    const results = await Promise.allSettled(
      list.map((r) =>
        plainFetch(`${CTB_BASE}/eta/CTB/${ctbId}/${r.trim()}`)
          .then((j) => (j.data || []).map(normalizeETAFromCTB))
          .catch(() => [])
      )
    );
    results.forEach((r) => {
      if (r.status === "fulfilled") etas.push(...r.value);
    });
  }

  etas.sort((a, b) => {
    if (a.etaMinutes === null) return 1;
    if (b.etaMinutes === null) return -1;
    return a.etaMinutes - b.etaMinutes;
  });

  const seen = new Set<string>();
  return etas.filter((e) => {
    const key = `${e.operator}-${e.route}-${e.destEn}-${e.sequence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Cache for stop-links.json
let stopLinksCache: Record<string, {ctb: any[], mtr: any[], gmb: any[]}> | null = null;
async function getStopLinks() {
  if (!stopLinksCache) {
    stopLinksCache = await plainFetch("stop-links.json").catch(() => ({}));
  }
  return stopLinksCache || {};
}

// Cache for CTB stop -> routes
let ctbStopRoutesCache: Record<string, string[]> | null = null;
async function getCtbStopRoutes() {
  if (!ctbStopRoutesCache) {
    ctbStopRoutesCache = await plainFetch("ctb/stop-routes.json").catch(() => ({}));
  }
  return ctbStopRoutesCache || {};
}

/**
 * Get ETAs from ALL operators serving a stop (via cross-operator stop links).
 * For a KMB stop, also queries nearby CTB/MTR/GMB stops.
 */
const mtrRouteFileCache = new Map<string, any>();
async function loadMtrRouteFile(route: string, dir: string): Promise<any> {
  const key = `${route}-${dir}`;
  if (!mtrRouteFileCache.has(key)) {
    mtrRouteFileCache.set(key, await plainFetch(`mtr/routes/${key}.json`).catch(() => null));
  }
  return mtrRouteFileCache.get(key);
}

// The direction terminus for an MTR Bus stop: whichever bundled direction
// file contains the stop, its LAST stop is where buses from here are going.
// (Stop-links only carry the stop's own name, which must NOT be used as the
// destination label - that made every MTR bus read "to <this stop>".)
async function getMtrBusDirectionDest(
  route: string,
  stopId: string
): Promise<{ tc: string; en: string } | null> {
  for (const dir of ["O", "I"]) {
    const data = await loadMtrRouteFile(route, dir);
    const stops = data?.stops || [];
    if (stops.length && stops.some((s: any) => s.stop_id === stopId)) {
      const last = stops[stops.length - 1];
      return { tc: last.name_tc, en: last.name_en };
    }
  }
  // Fallback: the stop itself is missing from the bundled list (added by MTR
  // later), but its U/D series still identifies the direction - only trust
  // this when the direction file is a clean single-series list.
  const series = stopId.includes("-U") ? "U" : stopId.includes("-D") ? "D" : null;
  const wantDir = series === "U" ? "O" : series === "D" ? "I" : null;
  if (wantDir) {
    const data = await loadMtrRouteFile(route, wantDir);
    const stops = data?.stops || [];
    if (
      stops.length &&
      stops.every((s: any) => String(s.stop_id).includes(`-${series}`))
    ) {
      const last = stops[stops.length - 1];
      return { tc: last.name_tc, en: last.name_en };
    }
  }
  return null;
}

export async function getAllETAsForStop(
  stop: { id: string; originalIds: { operator: string; id: string }[]; gmb?: any }
): Promise<ETA[]> {
  const allEtas: ETA[] = [];
  const promises: Promise<ETA[]>[] = [];

  // 1. Primary operator ETAs (existing logic)
  const kmbOrig = stop.originalIds.find((o) => o.operator === "KMB");
  const ctbOrig = stop.originalIds.find((o) => o.operator === "CTB");
  if (stop.gmb) {
    promises.push(getETAs({ operator: "GMB", gmb: stop.gmb }));
  } else if (kmbOrig) {
    promises.push(getETAs({ stopId: stop.id, operator: "KMB", originalId: kmbOrig.id }));
  } else if (ctbOrig) {
    // CTB stop without known routes - try to get routes from stop-links or skip
    promises.push(getETAs({ stopId: stop.id, operator: "CTB", originalId: ctbOrig.id, routes: "" }));
  }

  // 2. Cross-operator linked stops
  try {
    const links = await getStopLinks();
    // Try multiple ID formats (kmb-xxx, merged-xxx, raw)
    const linkKey = Object.keys(links).find(k => stop.id.includes(k) || k.includes(stop.id.replace(/^kmb-/, '').replace(/^merged-[^-]+-/, '')));
    let link = linkKey ? links[linkKey] : links[stop.id];
    // Hard fallback for 皇崗口岸 HU900 (port opened 2026-10-12, data may be stale)
    if (!link && (stop.id.includes("HU900") || (stop as any).nameTc?.includes("皇崗口岸"))) {
      link = { ctb: [{ id: "003939", dist: 10 }], mtr: [], gmb: [] };
    }
    if (link) {
      // CTB linked stops: query ETA for the NEAREST linked stop only
      // (limit 1 stop to avoid request storm). stop-links.json is NOT
      // sorted by distance, and CTB stops are direction-specific -
      // opposite sides of the road are different stops. Taking list
      // order first showed the wrong direction's buses at 老鼠洲兒童
      // 遊樂場 (TM690: list-first 001923 inbound, 26.2m, while the
      // correct outbound stop 001922 is 13.1m away). Nearest wins.
      const ctbRoutes = await getCtbStopRoutes();
      const ctbSorted = [...(link.ctb || [])].sort((a, b) => (a.dist ?? 9999) - (b.dist ?? 9999));
      for (const ctb of ctbSorted.slice(0, 1)) {
        const routes = (ctbRoutes[ctb.id] || []).slice(0, 4).join(",");
        if (routes) {
          promises.push(
            getETAs({ operator: "CTB", originalId: ctb.id, routes }).catch(() => [] as ETA[])
          );
        }
      }
      // MTR linked stops (limit 2). Destination label = the direction's
      // terminus (from the bundled route file), NOT the stop's own name.
      for (const mtr of (link.mtr || []).slice(0, 2)) {
        const dest = await getMtrBusDirectionDest(mtr.route, mtr.id).catch(() => null);
        promises.push(
          getETAs({
            operator: "MTR",
            mtr: {
              routeName: mtr.route,
              stopId: mtr.id,
              dest_tc: dest?.tc || mtr.name_tc,
              dest_en: dest?.en || mtr.name_en,
            },
          }).catch(() => [] as ETA[])
        );
      }
      // GMB linked stops: same nearest-wins rule as CTB (GMB stops are
      // also direction-specific; list order is not distance order).
      // Up to 4 routes per stop to cover multi-route stops like 43C
      // which may not be first in the list; proxy handles the load.
      const gmbSorted = [...(link.gmb || [])].sort((a, b) => (a.dist ?? 9999) - (b.dist ?? 9999));
      for (const g of gmbSorted.slice(0, 1)) {
        for (const rd of (g.routes_detail || []).slice(0, 4)) {
          promises.push(
            getETAs({
              operator: "GMB",
              gmb: {
                route_id: rd.route_id,
                route_seq: rd.route_seq,
                stop_seq: rd.stop_seq,
                code: rd.code,
                dest_tc: rd.dest_tc,
                dest_en: rd.dest_en,
              },
            }).catch(() => [] as ETA[])
          );
        }
      }
    }
  } catch {
    /* links optional */
  }

  // Timeout after 15s to prevent hangs
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), 15000)
  );
  let results: PromiseSettledResult<ETA[]>[] = [];
  try {
    results = await Promise.race([
      Promise.allSettled(promises),
      timeout.then(() => [] as PromiseSettledResult<ETA[]>[]),
    ]);
  } catch {
    results = [];
  }
  for (const r of results) {
    if (r.status === "fulfilled") allEtas.push(...r.value);
  }

  // Sort and dedupe
  // Dedupe key includes etaMinutes to catch true duplicates (same bus from
  // multiple sources). Different directions have different destEn, so they
  // are preserved.
  allEtas.sort((a, b) => {
    if (a.etaMinutes === null) return 1;
    if (b.etaMinutes === null) return -1;
    return a.etaMinutes - b.etaMinutes;
  });
  const seen = new Set<string>();
  return allEtas.filter((e) => {
    const key = `${e.operator}-${e.route}-${e.destEn}-${e.etaMinutes}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
