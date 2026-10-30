"use client";

import React from "react";
import useSWR from "swr";
import type { FavoriteRouteStop } from "@/types/bus";
import { clsx } from "clsx";
import { Heart, X } from "lucide-react";
import { OperatorBadge } from "./LiteApp";

/**
 * HeartListItem: A heart in the favorites list that shows LIVE ETAs directly.
 * No need to tap in to see the bus info.
 */
export function HeartListItem({
  heart,
  index,
  total,
  editOrder,
  onTap,
  onRemove,
  onMove,
}: {
  heart: FavoriteRouteStop;
  index: number;
  total: number;
  editOrder: boolean;
  onTap: () => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  // Fetch live ETAs for this heart's stop
  const { data: etas, isLoading } = useSWR(
    ["heart-list-eta", heart.id],
    async () => {
      const { getRouteStops, getETAs } = await import("@/utils/static-api");
      // For LRT/MTRT, skip getRouteStops (it doesn't support these operators) - fetch directly
      // For LRT, fetch directly
      // Fallback: if no lrt field (old heart), try to lookup stationId by name
      let lrtSid = heart.lrt?.stationId;
      if (heart.operator === "LRT" && !lrtSid) {
        try {
          const lrtData = await fetch("mtr/light-rail.json").then((r) => r.json());
          const stops = lrtData.stops || {};
          const targetName = (heart.stopNameTc || "").replace(/站$/, "");
          for (const [sid, s] of Object.entries(stops) as any) {
            if ((s as any).tc === targetName || (s as any).tc === heart.stopNameTc) {
              lrtSid = sid;
              break;
            }
          }
        } catch {}
      }
      if (heart.operator === "LRT" && lrtSid) {
        try {
          const res = await fetch(
            `https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule?station_id=${lrtSid}`
          ).then((r) => r.json());
          if (res.status === 1 && res.platform_list) {
            const trains: any[] = [];
            for (const plat of res.platform_list) {
              for (const r of plat.route_list || []) {
                const timeStr = r.time_ch || r.time_en || "-";
                let mins: number | null = null;
                const m = timeStr.match(/(\d+)/);
                if (m) mins = parseInt(m[1], 10);
                if (timeStr.includes("即將") || timeStr.toLowerCase().includes("arriving")) mins = 0;
                trains.push({
                  id: `lrt-${lrtSid}-${r.route_no}`,
                  operator: "LRT" as const,
                  route: `${r.route_no}號`,
                  destEn: r.dest_en || "",
                  destTc: r.dest_ch || "",
                  etaMinutes: mins,
                  sequence: trains.length + 1,
                });
              }
            }
            return trains.slice(0, 3);
          }
        } catch {}
        return [];
      }
      // For MTR, fetch directly
      // Fallback: if no mtrt field (old heart), try to lookup by station name
      let mtrLine = heart.mtrt?.line;
      let mtrSta = heart.mtrt?.sta;
      let mtrLineTc = heart.mtrt?.lineTc || "";
      if (heart.operator === "MTRT" && (!mtrLine || !mtrSta)) {
        try {
          const mtrData = await fetch("mtr/train-stations.json").then((r) => r.json());
          const targetName = (heart.stopNameTc || "").replace(/站$/, "");
          for (const [lineCode, stations] of Object.entries(mtrData.lines || {}) as any) {
            if (!Array.isArray(stations)) continue;
            for (const s of stations) {
              if (s.tc === targetName || s.tc === heart.stopNameTc) {
                mtrLine = lineCode;
                mtrSta = s.code;
                mtrLineTc = s.tc;
                break;
              }
            }
            if (mtrLine && mtrSta) break;
          }
        } catch {}
      }
      if (heart.operator === "MTRT" && mtrLine && mtrSta) {
        try {
          const res = await fetch(
            `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${mtrLine}&sta=${mtrSta}&lang=TC`
          ).then((r) => r.json());
          const trains: any[] = [];
          const data = res.data?.[`${mtrLine}-${mtrSta}`];
          if (data) {
            for (const dir of ["UP", "DOWN"]) {
              const list = data[dir] || [];
              for (const t of list.slice(0, 2)) {
                // Parse "2026-10-19 12:18:07" format
                let mins: number | null = null;
                const timeStr = t.time || "";
                if (timeStr.includes("-") && timeStr.includes(":")) {
                  const arr = new Date(timeStr.replace(" ", "T"));
                  if (!isNaN(arr.getTime())) {
                    mins = Math.round((arr.getTime() - Date.now()) / 60000);
                    if (mins < 0) mins = 0;
                  }
                }
                trains.push({
                  id: `mtr-${mtrSta}-${dir}-${t.seq}`,
                  operator: "MTRT" as const,
                  route: mtrLineTc || heart.destTc,
                  destTc: t.dest || "",
                  destEn: t.dest || "",
                  etaMinutes: mins,
                  sequence: trains.length + 1,
                });
              }
            }
          }
          return trains.slice(0, 3);
        } catch {}
        return [];
      }
      // For GMB, need to pass gmb metadata with route_id/route_seq/stop_seq
      if (heart.operator === "GMB" && heart.gmb) {
        return getETAs({
          operator: "GMB",
          gmb: {
            route_id: heart.gmb.route_id,
            route_seq: heart.gmb.route_seq,
            stop_seq: heart.stopSeq,
            code: heart.route,
            dest_tc: heart.destTc,
            dest_en: heart.destEn,
          },
        } as any);
      }
      // For ferries: shared ETA helper (pierSeq 2 = reverse direction)
      if (heart.ferry) {
        return getETAs({
          operator: heart.operator as any,
          ferry: {
            ...heart.ferry,
            dest_tc: heart.destTc,
            dest_en: heart.destEn,
            from_tc: heart.originTc,
            from_en: heart.originEn,
            pierSeq: heart.stopSeq,
          },
        } as any);
      }
      // For NLB: routeId + stopSeq (= NLB stopId) drive the ETA call
      if (heart.operator === "NLB" && heart.nlb) {
        return getETAs({
          operator: "NLB",
          nlb: {
            routeId: heart.nlb.routeId,
            stopId: heart.stopSeq,
            routeNo: heart.route,
            dest_tc: heart.destTc,
            dest_en: heart.destEn,
          },
        } as any);
      }
      // For buses (KMB/CTB/MTR Bus): get stop via getRouteStops
      const stops = await getRouteStops(
        heart.route,
        heart.operator as any,
        heart.bound || "O",
        heart.gmb
      );
      const stop = stops[heart.stopSeq - 1];
      if (!stop) return [];
      return getETAs({
        operator: heart.operator as any,
        stopId: stop.stop,
        route: heart.route,
      } as any);
    },
    {
      refreshInterval: 10000,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return (
    <div className="bg-white rounded-2xl border border-green-100 shadow-sm px-4 py-3 overflow-hidden">
      <div className="flex items-start gap-2">
        {editOrder && (
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={() => onMove("up")}
              disabled={index === 0}
              className="p-1.5 rounded-lg bg-slate-100 disabled:opacity-30"
              aria-label="上移"
            >
              <span className="text-[14px]">▲</span>
            </button>
            <button
              onClick={() => onMove("down")}
              disabled={index === total - 1}
              className="p-1.5 rounded-lg bg-slate-100 disabled:opacity-30"
              aria-label="下移"
            >
              <span className="text-[14px]">▼</span>
            </button>
          </div>
        )}
        {/* LEFT: info */}
        <button
          onClick={() => !editOrder && onTap()}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <Heart className="w-5 h-5 text-green-600 fill-green-600 shrink-0" />
            <OperatorBadge operator={heart.operator} />
            <span className="font-bold text-slate-900 text-[16px] shrink-0">{heart.route}</span>
            <span className="text-[13px] font-medium text-slate-500 truncate min-w-0">
              第 {heart.stopSeq} 站 · {heart.stopNameTc || heart.stopNameEn}
            </span>
          </div>
          <div className="text-[14px] text-slate-500 truncate mt-0.5 ml-7">
            往 {heart.destTc || heart.destEn}
            {heart.directionLabel && ` · ${heart.directionLabel}`}
          </div>
        </button>
        {/* RIGHT: times, right-aligned (short ETA strings only — the long
            timetable note lives in its own full-width row below so it can
            never squeeze the title row and overlap) */}
        {!editOrder && (
          <div className="shrink-0 text-right pt-0.5">
            {isLoading ? (
              <div className="text-[13px] text-slate-400">載入中…</div>
            ) : !etas || etas.length === 0 ? null : (
              <div className="flex flex-col items-end gap-0.5">
                {etas.slice(0, 3).map((e, i) => {
                  const urgent = e.etaMinutes !== null && e.etaMinutes <= 3 && e.etaMinutes >= 0;
                  return (
                    <span
                      key={i}
                      className={clsx(
                        "tabular-nums whitespace-nowrap",
                        i === 0
                          ? "text-[16px] font-bold"
                          : "text-[13px] font-medium text-slate-500",
                        e.etaMinutes !== null && e.etaMinutes <= 1
                          ? "text-emerald-600"
                          : e.etaMinutes !== null && e.etaMinutes <= 5
                            ? "text-amber-600"
                            : "text-slate-700",
                        urgent && "eta-urgent px-1 rounded"
                      )}
                    >
                      {e.etaMinutes === null
                        ? (e.remarkTc || "—")
                        : e.etaMinutes <= 0
                          ? "即將到站"
                          : (() => {
                              const arrival = new Date(Date.now() + e.etaMinutes! * 60000);
                              const hh = String(arrival.getHours()).padStart(2, "0");
                              const mm = String(arrival.getMinutes()).padStart(2, "0");
                              return `${e.etaMinutes}′ (${hh}:${mm})`;
                            })()}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {!editOrder && (
          <button
            onClick={onRemove}
            className="p-2 shrink-0"
            aria-label="取消心水站"
          >
            <X className="w-4 h-4 text-slate-300" />
          </button>
        )}
      </div>
      {/* No live ETA (e.g. service ended): timetable note gets its own
          full-width row so long text wraps instead of overlapping */}
      {!editOrder && !isLoading && (!etas || etas.length === 0) && (
        <div className="mt-1.5 ml-7">
          <TimetableNote heart={heart} />
        </div>
      )}
    </div>
  );
}

// Shows timetable info when no real-time ETA (e.g. night).
// Sources, in order: (1) bulk official GMB timetables (per direction,
// day-type aware), (2) the small hand-verified timetables.json.
let gmbTtCache: Promise<any> | null = null;
let holidaysCache2: Promise<string[]> | null = null;
function loadGmbTt(): Promise<any> {
  if (!gmbTtCache) {
    gmbTtCache = fetch("gmb-timetables.json").then((r) => r.json()).catch(() => null);
  }
  return gmbTtCache;
}
function loadHolidays2(): Promise<string[]> {
  if (!holidaysCache2) {
    holidaysCache2 = fetch("ferry/hk-holidays.json").then((r) => r.json()).catch(() => []);
  }
  return holidaysCache2;
}

type NoteInfo = { first?: string; last?: string; note?: string; noServiceToday?: boolean };

function gmbNoteFor(heart: FavoriteRouteStop, data: any, holidays: string[]): NoteInfo | null {
  const g = (heart as any).gmb;
  if (!g || !data?.routes) return null;
  const entry = data.routes[`GMB-${g.region}-${g.code}`];
  if (!entry) return null;
  const dir = (entry.dirs || []).find((d: any) => d.seq === g.route_seq) || (entry.dirs || [])[0];
  if (!dir || !(dir.periods || []).length) return null;
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const isPH = holidays.includes(ymd);
  const idx = (now.getDay() + 6) % 7; // Mon=0 ... Sun=6
  let periods: any[] = [];
  if (isPH) {
    periods = dir.periods.filter((p: any) => p.ph);
    if (!periods.length) periods = dir.periods.filter((p: any) => p.days && p.days[6]);
  } else {
    periods = dir.periods.filter((p: any) => p.days && p.days[idx]);
  }
  if (!periods.length) {
    return { noServiceToday: true, note: `${dir.orig_tc}往${dir.dest_tc}（總站開出）· 運輸署資料 ${data.generated || ""}` };
  }
  const first = periods.map((p: any) => p.start).sort()[0];
  const last = periods.map((p: any) => p.end).sort()[periods.length - 1];
  const fMin = Math.min(...periods.map((p: any) => p.f1 || 0).filter((x: number) => x > 0));
  const fMax = Math.max(...periods.map((p: any) => p.f2 || p.f1 || 0));
  const freq = fMin === fMax ? `${fMin}` : `${fMin}–${fMax}`;
  return {
    first,
    last,
    note: `${dir.orig_tc}往${dir.dest_tc}（總站開出）· 約 ${freq} 分鐘一班 · 運輸署資料 ${data.generated || ""}`,
  };
}

let busTtCache: Promise<any> | null = null;
function loadBusTt(): Promise<any> {
  if (!busTtCache) {
    busTtCache = fetch("bus-timetables.json").then((r) => r.json()).catch(() => null);
  }
  return busTtCache;
}

// KMB/LWB/CTB note from the TD GTFS bundle. Day index follows the GTFS
// convention (0=Sunday..6=Saturday = Date.getDay()); public holidays use
// the Sunday pattern, the standard HK arrangement in this dataset.
function busNoteFor(heart: FavoriteRouteStop, data: any, holidays: string[]): NoteInfo | null {
  if (!data?.routes) return null;
  const rid = (heart as any).routeId || "";
  let key: string | null = null;
  if (rid.startsWith("KMB-")) {
    key = rid;
  } else if (rid.startsWith("MTR-")) {
    key = rid; // MTR Bus routeId is already "MTR-{route}-{O|I}"
  } else if (heart.operator === "NLB") {
    key = `NLB-${heart.route}`;
  } else if (heart.operator === "SUNFERRY" && (heart as any).ferry) {
    key = `SUN-${(heart as any).ferry.code}`;
  } else if (heart.operator === "HKKF" && (heart as any).ferry) {
    key = `HKKF-${(heart as any).ferry.code}-${(heart as any).ferry.dir === "inbound" ? "I" : "O"}`;
  } else if (rid.startsWith("CTB-")) {
    const route = rid.slice(4).replace(/-(inbound|outbound)$/, "");
    key = `CTB-${route}-${rid.endsWith("inbound") ? "I" : "O"}`;
  }
  if (!key) {
    const b: string | undefined = (heart as any).bound;
    const bl = b === "inbound" ? "I" : b === "outbound" ? "O" : b;
    if (!bl) return null;
    if (heart.operator === "CTB") key = `CTB-${heart.route}-${bl}`;
    else if (heart.operator === "KMB" || heart.operator === "LWB")
      key = `KMB-${heart.route}-${bl}-${(heart as any).serviceType || 1}`;
  }
  const variants = key ? data.routes[key] : null;
  if (!variants || !variants.length) return null;
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const idx = holidays.includes(ymd) ? 0 : now.getDay();
  const norm = (s: string) => (s || "").replace(/\s/g, "").replace(/（/g, "(").replace(/）/g, ")");
  const exact = variants.find((v: any) => norm(v.o) === norm(heart.originTc) && norm(v.d) === norm(heart.destTc));
  let variant = exact;
  if (!variant) {
    const destPool = variants.filter((v: any) => norm(v.d) === norm(heart.destTc));
    const pool = destPool.length ? destPool : variants;
    const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    let bestSpan = -1;
    for (const v of pool) {
      const day = v.days ? v.days[idx] : null;
      if (!day) continue;
      const span = toMin(day.l) + (day.ln ? 1440 : 0) - toMin(day.f);
      if (span > bestSpan) { bestSpan = span; variant = v; }
    }
    if (!variant) variant = pool[0];
  }
  if (!variant) return null;
  const day = variant.days ? variant.days[idx] : null;
  const srcNote = `${variant.o}往${variant.d}（總站開出）· 運輸署資料 ${data.generated || ""}`;
  if (!day) return { noServiceToday: true, note: srcNote };
  const freq = day.fx
    ? "固定班次開出"
    : `約 ${day.a === day.b ? day.a : `${day.a}–${day.b}`} 分鐘一班`;
  return {
    first: day.f,
    last: day.l + (day.ln ? "（翌日）" : ""),
    note: `${variant.o}往${variant.d}（總站開出）· ${freq} · 運輸署資料 ${data.generated || ""}`,
  };
}

let starTtCache2: Promise<any> | null = null;
function loadStarTt2(): Promise<any> {
  if (!starTtCache2) {
    starTtCache2 = fetch("ferry/star-timetable.json").then((r) => r.json()).catch(() => null);
  }
  return starTtCache2;
}

// Star Ferry: official data is a frequency table, so first/last are the
// first/last sailing windows of today's pattern (same matcher as the ETA).
function starNoteFor(heart: FavoriteRouteStop, tt: any, holidays: string[]): NoteInfo | null {
  const f: any = (heart as any).ferry;
  if (!f?.starDir || !tt) return null;
  const table = tt[f.starDir];
  if (!table) return null;
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const isPH = holidays.includes(ymd);
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
  const periods: any[] = [];
  for (const [key, ps] of Object.entries(table)) {
    if (matches(key)) periods.push(...(ps as any[]));
  }
  if (!periods.length) return { noServiceToday: true, note: "天星小輪官方時間表" };
  const first = periods.map((p: any) => p.start).sort()[0];
  const last = periods.map((p: any) => p.end).sort()[periods.length - 1];
  const fMin = Math.min(...periods.map((p: any) => p.freqMin));
  const fMax = Math.max(...periods.map((p: any) => p.freqMax));
  return {
    first,
    last,
    note: `${heart.originTc}往${heart.destTc}（總站開出）· 約 ${fMin === fMax ? fMin : `${fMin}–${fMax}`} 分鐘一班 · 天星小輪官方時間表`,
  };
}

let lrtTtCache: Promise<any> | null = null;
function loadLrtTt(): Promise<any> {
  if (!lrtTtCache) {
    lrtTtCache = fetch("lrt-timetables.json").then((r) => r.json()).catch(() => null);
  }
  return lrtTtCache;
}

// Light Rail: MTR's official table is per-stop, so first/last here are
// the times AT this stop for this direction (not terminus departures).
function lrtNoteFor(heart: FavoriteRouteStop, data: any): NoteInfo | null {
  const sid = (heart as any).lrt?.stationId;
  const rd = data?.routes?.[heart.route];
  if (!sid || !rd?.dirs?.length) return null;
  const norm = (s: string) => (s || "").replace(/\s/g, "").replace(/站$/, "");
  const dir =
    rd.dirs.find((d: any) => norm(d.dest_tc) === norm(heart.destTc)) ||
    rd.dirs.find((d: any) => norm(heart.destTc).includes(norm(d.dest_tc)) || norm(d.dest_tc).includes(norm(heart.destTc))) ||
    (rd.dirs.length === 1 ? rd.dirs[0] : null);
  const entry = dir?.stops?.[sid];
  if (!entry) return null;
  return {
    first: entry.f,
    last: entry.l,
    note: `此站往${dir.dest_tc} · 港鐵輕鐵官方時間表 ${data.generated || ""}`,
  };
}

let mtrTtCache: Promise<any> | null = null;
function loadMtrTt(): Promise<any> {
  if (!mtrTtCache) {
    mtrTtCache = fetch("mtr-timetables.json").then((r) => r.json()).catch(() => null);
  }
  return mtrTtCache;
}

// Heavy rail: MTR publishes first/last trains per station per destination.
// Exact destination row wins; otherwise aggregate this station's rows that
// run in the heart's direction (earliest first, latest last).
function mtrNoteFor(heart: FavoriteRouteStop, data: any): NoteInfo | null {
  const m: any = (heart as any).mtrt;
  if (!m?.line || !m?.sta) return null;
  const ld = data?.lines?.[m.line];
  const rowsForStop = ld?.stations?.[m.sta];
  if (!rowsForStop?.length) return null;
  const norm = (s: string) => (s || "").replace(/\s/g, "").replace(/站$/, "");
  const exact = rowsForStop.find((r: any) => norm(r.dtc) === norm(heart.destTc));
  if (exact) {
    return { first: exact.f, last: exact.l, note: `此站往${exact.dtc} · 港鐵官方服務時間 ${data.generated || ""}` };
  }
  const names: Record<string, string> = ld.names || {};
  const destCode = Object.keys(names).find((code) => norm(names[code]) === norm(heart.destTc));
  const pos: Record<string, number> = ld.pos || {};
  const myPos = pos[m.sta];
  const destPos = destCode ? pos[destCode] : undefined;
  if (myPos === undefined || destPos === undefined || destPos === myPos) return null;
  const dirSign = destPos > myPos ? 1 : -1;
  const cand = rowsForStop.filter((r: any) => {
    const p = pos[r.d];
    return p !== undefined && p !== myPos && (p > myPos ? 1 : -1) === dirSign;
  });
  if (!cand.length) return null;
  const first = cand.map((r: any) => r.f).sort()[0];
  const last = cand.map((r: any) => r.l).sort()[cand.length - 1];
  return { first, last, note: `此站往${heart.destTc}方向 · 港鐵官方服務時間 ${data.generated || ""}` };
}

function TimetableNote({ heart, alignRight }: { heart: FavoriteRouteStop; alignRight?: boolean }) {
  const [info, setInfo] = React.useState<NoteInfo | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      // (1) GMB bulk official timetables
      if (heart.operator === "GMB") {
        try {
          const [data, holidays] = await Promise.all([loadGmbTt(), loadHolidays2()]);
          const n = data ? gmbNoteFor(heart, data, holidays || []) : null;
          if (n) {
            if (alive) { setInfo(n); setLoaded(true); }
            return;
          }
        } catch {}
      }
      // (1.5) Light Rail per-stop official table
      if (heart.operator === "LRT") {
        try {
          const lrtData = await loadLrtTt();
          const n = lrtData ? lrtNoteFor(heart, lrtData) : null;
          if (n) {
            if (alive) { setInfo(n); setLoaded(true); }
            return;
          }
        } catch {}
      }
      // (1.6) Heavy rail per-station official service hours
      if (heart.operator === "MTRT") {
        try {
          const mtrData = await loadMtrTt();
          const n = mtrData ? mtrNoteFor(heart, mtrData) : null;
          if (n) {
            if (alive) { setInfo(n); setLoaded(true); }
            return;
          }
        } catch {}
      }
      // (2) hand-verified static entries
      try {
        const data = await fetch("timetables.json").then((r) => r.json());
        const keys = [
          `${heart.operator}-${heart.route}`,
          `LRT-${heart.route}`,
          heart.operator === "LRT" ? `LRT-505` : null,
        ].filter(Boolean);
        for (const k of keys) {
          if (data[k as string]) {
            if (alive) { setInfo({ first: data[k as string].first, last: data[k as string].last, note: data[k as string].note }); setLoaded(true); }
            return;
          }
        }
      } catch {}
      // (3) Bulk TD timetables: KMB/LWB/CTB + NLB + MTR Bus + Sun/HKKF ferries
      if (["KMB", "LWB", "CTB", "NLB", "MTR", "SUNFERRY", "HKKF"].includes(heart.operator)) {
        try {
          const [data, holidays] = await Promise.all([loadBusTt(), loadHolidays2()]);
          const n = data ? busNoteFor(heart, data, holidays || []) : null;
          if (n) {
            if (alive) { setInfo(n); setLoaded(true); }
            return;
          }
        } catch {}
      }
      // (4) Star Ferry frequency table
      if (heart.operator === "STARFERRY") {
        try {
          const [tt, holidays] = await Promise.all([loadStarTt2(), loadHolidays2()]);
          const n = tt ? starNoteFor(heart, tt, holidays || []) : null;
          if (n) {
            if (alive) { setInfo(n); setLoaded(true); }
            return;
          }
        } catch {}
      }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [heart]);

  if (!loaded) return <div className="text-[14px] text-slate-400">暫無班次</div>;
  if (!info) return <div className="text-[14px] text-slate-400">暫無班次</div>;
  if (info.noServiceToday) {
    return (
      <div className={clsx("text-[13px] text-slate-500", alignRight && "text-right")}>
        暫無班次 · 今日暫停服務（官方時間表）
        {info.note && <span className="block text-[12px] text-slate-400">{info.note}</span>}
      </div>
    );
  }
  return (
    <div className={clsx("text-[13px] text-slate-500", alignRight && "text-right")}>
      暫無班次 · 首班車 {info.first}，尾班車 {info.last}
      {info.note && <span className="block text-[12px] text-slate-400">{info.note}</span>}
    </div>
  );
}
