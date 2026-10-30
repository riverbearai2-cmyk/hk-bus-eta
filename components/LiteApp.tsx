"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  Search,
  MapPin,
  Star,
  StarOff,
  X,
  LocateFixed,
  RefreshCw,
  ChevronDown,
  Bus,
  Navigation,
  Heart,
} from "lucide-react";
import type { BusStop, ETA, BusRoute, FavoriteRoute, FavoriteRouteStop, RouteStopSeq } from "@/types/bus";
import { useETA, useRouteSearch, useRouteStops, useStops } from "@/hooks/useBusData";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useFavorites } from "@/hooks/useFavorites";
import { useFavoriteRoutes } from "@/hooks/useFavoriteRoutes";
import { useFavoriteHearts } from "@/hooks/useFavoriteHearts";
import { useRoutesSortedByDistance } from "@/hooks/useRoutesSortedByDistance";
import { MTRTStationETAs } from "@/components/MTRTStationETAs";
import { LRTStationETAs } from "@/components/LRTStationETAs";
import { useNearbyTransport } from "@/hooks/useNearbyTransport";
import { NearbyTransportCard } from "@/components/NearbyTransportCard";
import { HeartFocusView } from "@/components/HeartFocusView";
import { HeartListItem } from "@/components/HeartListItem";
import { findClosestStops, haversineDistance } from "@/utils/geo";
import clsx from "clsx";

/* ---------- shared bits ---------- */

// App name + version: bump patch version on every user-facing change
export const APP_NAME = "CNE 交通資訊";
export const APP_VERSION = "1.1.27";

export function OperatorBadge({ operator }: { operator: string }) {
  const src =
    operator === "KMB" || operator === "LWB"
      ? "logos/kmb.svg"
      : operator === "GMB"
        ? "logos/gmb.svg"
        : operator === "MTR"
          ? "logos/mtr.svg"
          : operator === "LRT"
            ? "logos/lrt.svg"
            : "logos/ctb.svg";
  const alt =
    operator === "KMB" || operator === "LWB"
      ? "九巴"
      : operator === "GMB"
        ? "小巴"
        : operator === "MTR"
          ? "港鐵巴士"
          : operator === "LRT"
            ? "輕鐵"
            : operator === "MTRT"
              ? "港鐵"
              : "城巴";
  if (operator === "MTRT") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#8e44ad] text-white shrink-0">
        鐵路
      </span>
    );
  }
  if (operator === "NLB") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#0077b6] text-white shrink-0">
        嶼巴
      </span>
    );
  }
  if (operator === "SUNFERRY") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#0057a8] text-white shrink-0">
        新渡輪
      </span>
    );
  }
  if (operator === "HKKF") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#00838f] text-white shrink-0">
        港九小輪
      </span>
    );
  }
  if (operator === "STARFERRY") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#00703c] text-white shrink-0">
        天星小輪
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="h-[22px] w-auto rounded shrink-0"
      loading="lazy"
    />
  );
}

function etaText(e: ETA): string {
  if (e.etaMinutes === null) return e.remarkTc || e.remarkEn || "—";
  if (e.etaMinutes <= 0) return "即將到站";
  const arrival = new Date(Date.now() + e.etaMinutes * 60000);
  const hh = String(arrival.getHours()).padStart(2, "0");
  const mm = String(arrival.getMinutes()).padStart(2, "0");
  return `${e.etaMinutes} 分鐘 (${hh}:${mm})`;
}

function etaColor(e: ETA): string {
  if (e.etaMinutes === null) return "text-slate-400";
  if (e.etaMinutes <= 1) return "text-emerald-600";
  if (e.etaMinutes <= 5) return "text-amber-600";
  return "text-slate-700";
}

// Urgent: bus arriving within 3 minutes -> red flashing
function isUrgent(e: ETA): boolean {
  return e.etaMinutes !== null && e.etaMinutes <= 3 && e.etaMinutes >= 0;
}

/* ---------- nearby stop card with live ETAs ---------- */

function NearbyStopCard({
  stop,
  distance,
  isFavorite,
  toggleFavorite,
  defaultExpanded,
  onTapRoute,
}: {
  stop: BusStop;
  distance: number;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (stop: BusStop) => void;
  defaultExpanded: boolean;
  onTapRoute: (eta: ETA) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { etas, isLoading, refresh } = useETA(stop, true);
  const fav = isFavorite(stop.id);

  const shown = expanded ? etas : etas.slice(0, 4);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 active:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 text-[17px] truncate">
              {stop.nameTc || stop.nameEn}
            </span>
            <span className="text-[12px] text-green-600 font-medium tabular-nums shrink-0">
              {distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(1)}km`}
            </span>
          </div>
          {stop.nameTc && stop.nameEn && stop.nameTc !== stop.nameEn && (
            <div className="text-[13px] text-slate-400 truncate mt-0.5">{stop.nameEn}</div>
          )}
        </div>
        <ChevronDown
          className={clsx("w-5 h-5 text-slate-400 shrink-0 mt-0.5 transition-transform", expanded && "rotate-180")}
        />
      </button>

      <div className="px-4 pb-1">
        {isLoading && etas.length === 0 ? (
          <div className="py-3 text-[14px] text-slate-400">載入班次中…</div>
        ) : shown.length === 0 ? (
          <div className="py-3 text-[14px] text-slate-400">暫時冇班次資料</div>
        ) : (
          shown.map((e) => (
            <button
              key={e.id}
              onClick={() => onTapRoute(e)}
              className="w-full flex items-center gap-2 py-2 border-t border-slate-50 active:bg-green-50 text-left"
            >
              <OperatorBadge operator={e.operator} />
              <span className="font-bold text-green-700 text-[15px] tabular-nums underline decoration-green-200 underline-offset-2">{e.route}</span>
              <span className="text-[13px] text-slate-500 truncate flex-1">
                往 {e.destTc || e.destEn}
              </span>
              <span className={clsx("text-[14px] font-semibold tabular-nums shrink-0", etaColor(e), isUrgent(e) && "eta-urgent")}>
                {etaText(e)}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-2 bg-slate-50/60">
        <button
          onClick={() => refresh()}
          className="flex items-center gap-1 text-[13px] text-slate-500 active:text-green-600"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          更新
        </button>
        <button
          onClick={() => toggleFavorite(stop)}
          className="flex items-center gap-1 text-[13px] text-slate-500 active:text-amber-500"
          aria-label="收藏車站"
        >
          {fav ? (
            <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
          ) : (
            <StarOff className="w-4 h-4" />
          )}
          {fav ? "已收藏" : "收藏車站"}
        </button>
      </div>
    </div>
  );
}

/* ---------- route stop row (per-stop live ETA) ---------- */

function LiteRouteStopRow({
  seq,
  nameTc,
  nameEn,
  route,
  gmbMeta,
  kmbStopId,
  ctbStopId,
  mtrMeta,
  nlbMeta,
  ferryMeta,
  isHeart,
  onToggleHeart,
  lat,
  lng,
}: {
  seq: number;
  nameTc?: string;
  nameEn?: string;
  lat?: number;
  lng?: number;
  route: BusRoute;
  gmbMeta?: { region: string; code: string; route_id: number; route_seq: number };
  kmbStopId?: string;
  ctbStopId?: string;
  mtrMeta?: { routeName: string; stopId: string };
  nlbMeta?: { routeId: number; stopId: number };
  ferryMeta?: import("@/types/bus").FerryMeta;
  isHeart?: (route: BusRoute, seq: number) => boolean;
  onToggleHeart?: (route: BusRoute, seq: number, nameTc?: string, nameEn?: string) => void;
}) {
  const { data: etas } = useSWR(
    route.operator === "GMB" && gmbMeta
      ? (["lite-eta-gmb", gmbMeta.route_id, gmbMeta.route_seq, seq] as const)
      : route.operator === "KMB" && kmbStopId
        ? (["lite-eta-kmb", kmbStopId, route.route] as const)
        : route.operator === "CTB" && ctbStopId
          ? (["lite-eta-ctb", ctbStopId, route.route] as const)
          : route.operator === "MTR" && mtrMeta
            ? (["lite-eta-mtr", mtrMeta.routeName, mtrMeta.stopId] as const)
            : route.operator === "NLB" && nlbMeta
              ? (["lite-eta-nlb", nlbMeta.routeId, nlbMeta.stopId] as const)
              : ferryMeta && seq === 1
                ? (["lite-eta-ferry", ferryMeta.company, ferryMeta.code, ferryMeta.dir || ferryMeta.starDir || ""] as const)
                : null,
    async (key: readonly [string, ...unknown[]]) => {
      const { getETAs } = await import("@/utils/static-api");
      if (key[0] === "lite-eta-gmb" && gmbMeta) {
        return getETAs({
          operator: "GMB",
          gmb: {
            route_id: gmbMeta.route_id,
            route_seq: gmbMeta.route_seq,
            stop_seq: seq,
            code: gmbMeta.code,
            dest_tc: route.destTc,
            dest_en: route.destEn,
          },
        });
      } else if (key[0] === "lite-eta-kmb" && kmbStopId) {
        const all = await getETAs({ operator: "KMB", originalId: kmbStopId });
        return all.filter((e) => e.route === route.route).slice(0, 3);
      } else if (key[0] === "lite-eta-ctb" && ctbStopId) {
        return getETAs({ operator: "CTB", originalId: ctbStopId, routes: route.route });
      } else if (key[0] === "lite-eta-ferry" && ferryMeta) {
        return getETAs({
          operator: route.operator as any,
          ferry: {
            ...ferryMeta,
            dest_tc: route.destTc,
            dest_en: route.destEn,
            from_tc: route.originTc,
            from_en: route.originEn,
          },
        });
      } else if (key[0] === "lite-eta-nlb" && nlbMeta) {
        return getETAs({
          operator: "NLB",
          nlb: {
            routeId: nlbMeta.routeId,
            stopId: nlbMeta.stopId,
            routeNo: route.route,
            dest_tc: route.destTc,
            dest_en: route.destEn,
          },
        });
      } else if (key[0] === "lite-eta-mtr" && mtrMeta) {
        return getETAs({
          operator: "MTR",
          mtr: {
            routeName: mtrMeta.routeName,
            stopId: mtrMeta.stopId,
            dest_tc: route.destTc,
            dest_en: route.destEn,
          },
        });
      }
      return [];
    },
    { refreshInterval: 10000, revalidateOnFocus: false, dedupingInterval: 5000, errorRetryCount: 1 }
  );

  const { data: ctbName } = useSWR(
    route.operator === "CTB" && ctbStopId && !nameTc
      ? (["lite-ctb-name", ctbStopId] as const)
      : null,
    async () => {
      const { normalizeCTBStop } = await import("@/utils/api");
      const res = await fetch(`https://rt.data.gov.hk/v2/transport/citybus/stop/${ctbStopId}`)
        .then((r) => r.json())
        .catch(() => null);
      if (res?.data) {
        const n = normalizeCTBStop(res.data);
        return { nameTc: n.nameTc, nameEn: n.nameEn };
      }
      return null;
    },
    { revalidateOnFocus: false, dedupingInterval: 86400000, errorRetryCount: 1 }
  );

  const displayTc = nameTc || ctbName?.nameTc;
  const displayEn = nameEn || ctbName?.nameEn;
  const list = (etas || []).slice(0, 3);

  return (
    <div className="flex items-center gap-2 py-2.5 px-1 border-b border-slate-100 last:border-0">
      <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 text-[13px] font-semibold flex items-center justify-center shrink-0 tabular-nums">
        {seq}
      </div>
      <div
        className={clsx("min-w-0 flex-1", lat != null && lng != null && "cursor-pointer")}
        role={lat != null && lng != null ? "button" : undefined}
        aria-label={
          lat != null && lng != null
            ? `喺 Google 地圖導航去 ${displayTc || displayEn}`
            : undefined
        }
        title={lat != null && lng != null ? "撳一下開 Google 地圖導航去呢個站" : undefined}
        onClick={
          lat != null && lng != null
            ? () =>
                window.open(
                  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`,
                  "_blank"
                )
            : undefined
        }
      >
        <div className="flex items-center gap-1.5">
          <div className="text-[15px] font-medium text-slate-900 line-clamp-2 leading-snug">
            {displayTc || displayEn || `第 ${seq} 站`}
          </div>
          {lat != null && lng != null && (
            <Navigation className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          )}
        </div>
        {displayTc && displayEn && displayTc !== displayEn && (
          <div className="text-[13px] text-slate-400 truncate">{displayEn}</div>
        )}
      </div>
      {onToggleHeart && (
        <button
          onClick={() => onToggleHeart(route, seq, displayTc, displayEn)}
          className="p-1.5 shrink-0 active:scale-90 transition"
          aria-label={isHeart?.(route, seq) ? "取消心水站" : "設為心水站"}
        >
          <Heart
            className={clsx(
              "w-4.5 h-4.5",
              isHeart?.(route, seq)
                ? "text-green-600 fill-green-600"
                : "text-slate-300"
            )}
          />
        </button>
      )}
      <div className="shrink-0 text-right">
        {!etas ? (
          <span className="text-[13px] text-slate-300">…</span>
        ) : list.length === 0 ? (
          <span className="text-[13px] text-slate-300">—</span>
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            {list.map((e, i) => (
              <span key={i} className={clsx("text-[14px] font-semibold tabular-nums", etaColor(e), isUrgent(e) && "eta-urgent")}>
                {etaText(e)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LiteRouteStopsList({
  route,
  stopSeqs,
  stops,
  isHeart,
  onToggleHeart,
  highlightSeq,
}: {
  route: BusRoute;
  stopSeqs: RouteStopSeq[];
  stops: BusStop[];
  isHeart?: (route: BusRoute, seq: number) => boolean;
  onToggleHeart?: (route: BusRoute, seq: number, nameTc?: string, nameEn?: string) => void;
  highlightSeq?: number | null;
}) {
  const enriched = useMemo(() => {
    const byOrig = new Map<string, BusStop>();
    stops.forEach((s) => {
      s.originalIds.forEach((o) => byOrig.set(o.id, s));
      byOrig.set(s.id, s);
    });
    return [...stopSeqs]
      .sort((a, b) => a.seq - b.seq)
      .map((ss) => {
        if (ss.lat != null && ss.lng != null) {
          return {
            seq: ss.seq,
            nameTc: ss.name_tc,
            nameEn: ss.name_en,
            lat: ss.lat,
            lng: ss.lng,
            gmbMeta: route.gmb,
            kmbStopId: undefined as string | undefined,
            ctbStopId: undefined as string | undefined,
            mtrMeta:
              route.operator === "MTR"
                ? { routeName: route.route, stopId: ss.stop }
                : undefined,
            nlbMeta:
              route.operator === "NLB" && route.nlb
                ? { routeId: route.nlb.routeId, stopId: Number(ss.stop) }
                : undefined,
            ferryMeta: route.ferry,
          };
        }
        const found = byOrig.get(ss.stop);
        return {
          seq: Number(ss.seq) || 0,
          nameTc: found?.nameTc,
          nameEn: found?.nameEn,
          lat: found?.lat,
          lng: found?.lng,
          gmbMeta: undefined,
          kmbStopId: route.operator === "KMB" ? ss.stop : undefined,
          ctbStopId: route.operator === "CTB" ? ss.stop : undefined,
          mtrMeta: undefined,
          nlbMeta: undefined,
          ferryMeta: undefined,
        };
      });
  }, [stopSeqs, stops, route]);

  if (enriched.length === 0) return null;
  return (
    <div className="mt-3 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 text-[13px] font-semibold text-slate-500">
        {route.route} · {enriched.length} 個站 · 即時到站
      </div>
      <div className="px-3 pb-2">
        {enriched.map((s) => (
          <div
            key={s.seq}
            ref={(el) => {
              if (el && highlightSeq === s.seq) {
                el.scrollIntoView({ block: "center", behavior: "smooth" });
              }
            }}
            className={clsx(
              "rounded-xl transition-colors",
              highlightSeq === s.seq && "bg-green-50 ring-1 ring-green-200"
            )}
          >
            <LiteRouteStopRow
              seq={s.seq}
              nameTc={s.nameTc}
              nameEn={s.nameEn}
              route={route}
              gmbMeta={s.gmbMeta}
              kmbStopId={s.kmbStopId}
              ctbStopId={s.ctbStopId}
              mtrMeta={s.mtrMeta}
              nlbMeta={s.nlbMeta}
              ferryMeta={s.ferryMeta}
              lat={s.lat}
              lng={s.lng}
              isHeart={isHeart}
              onToggleHeart={onToggleHeart}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- main lite app ---------- */

type Tab = "nearby" | "routes" | "favorites";

// Component to show ETAs for a stop search result
function StopSearchResultETAs({ stop }: { stop: any }) {
  const { data: etas, isLoading } = useSWR(
    ["stop-search-etas", stop.id],
    async () => {
      const { getAllETAsForStop } = await import("@/utils/static-api");
      // Convert stop to the format getAllETAsForStop expects
      const stopObj = {
        id: stop.id,
        originalIds: stop.originalIds || [{ operator: "KMB", id: stop.id.replace(/^kmb-/, "") }],
        nameTc: stop.nameTc,
        nameEn: stop.nameEn,
      };
      return getAllETAsForStop(stopObj as any);
    },
    { refreshInterval: 10000, revalidateOnFocus: false }
  );

  if (isLoading) {
    return <div className="bg-white rounded-2xl p-6 text-center text-[15px] text-slate-500">載入班次中…</div>;
  }

  const list = etas || [];
  if (list.length === 0) {
    return <div className="bg-white rounded-2xl p-6 text-center text-[15px] text-slate-500">暫無班次資料</div>;
  }

  // Group by route + destination, keep earliest first
  const grouped = new Map<string, any[]>();
  for (const e of list) {
    const key = `${e.operator}-${e.route}-${e.destTc || e.destEn}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(e);
  }
  // Sort each group by etaMinutes (earliest first), then sort groups by earliest ETA
  const groups = Array.from(grouped.values()).map(g => {
    g.sort((a, b) => (a.etaMinutes ?? 9999) - (b.etaMinutes ?? 9999));
    return g;
  });
  groups.sort((a, b) => (a[0].etaMinutes ?? 9999) - (b[0].etaMinutes ?? 9999));

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="font-semibold text-[16px]">{stop.nameTc}</div>
        {stop.nameEn && <div className="text-[13px] text-slate-400">{stop.nameEn}</div>}
      </div>
      <div className="px-4 pb-2">
        {groups.map((g, gi) => {
          const first = g[0];
          const next3 = g.slice(0, 3);
          return (
            <div key={gi} className="py-2.5 border-b border-green-50 last:border-0 flex items-center gap-3">
              {/* LEFT: operator logo + route info */}
              <div className="min-w-0 flex-1 flex items-center gap-2.5">
                <OperatorBadge operator={first.operator} />
                <div className="min-w-0">
                  <div className="font-bold text-green-800 text-[16px] leading-tight">
                    {first.route}
                  </div>
                  <div className="text-[13px] text-slate-500 truncate">
                    往 {first.destTc || first.destEn}
                  </div>
                </div>
              </div>
              {/* RIGHT: at least 3 departure times, right-aligned */}
              <div className="shrink-0 text-right">
                <div className="flex flex-col items-end gap-0.5">
                  {next3.map((e: any, i: number) => (
                    <span
                      key={e.id || i}
                      className={clsx(
                        "tabular-nums leading-tight",
                        i === 0
                          ? "text-[16px] font-bold"
                          : "text-[13px] font-medium text-slate-500",
                        etaColor(e),
                        i === 0 && isUrgent(e) && "eta-urgent"
                      )}
                    >
                      {e.etaMinutes !== null
                        ? e.etaMinutes <= 0
                          ? "即將到站"
                          : `${e.etaMinutes} 分鐘`
                        : e.remarkTc || e.remarkEn || "—"}
                    </span>
                  ))}
                  {g.length === 0 && (
                    <span className="text-[13px] text-slate-300">—</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// CTB direction toggle: only shows when BOTH directions have stops in the API.
// One-way special routes (morning peaks, race-day specials, etc.) get no toggle.
function CtbDirectionToggle({
  route,
  originTc,
  destTc,
  current,
  onChange,
}: {
  route: string;
  originTc: string;
  destTc: string;
  current: "outbound" | "inbound";
  onChange: (d: "outbound" | "inbound") => void;
}) {
  const { stopSeqs: obStops } = useRouteStops(route, "CTB", "outbound");
  const { stopSeqs: ibStops } = useRouteStops(route, "CTB", "inbound");
  const hasOb = obStops.length > 0;
  const hasIb = ibStops.length > 0;
  // Don't show toggle for one-way routes
  if (!hasOb || !hasIb) return null;
  return (
    <div className="flex gap-1.5 mt-2">
      <button
        onClick={() => onChange("outbound")}
        className={`flex-1 rounded-full py-1.5 text-[13px] font-medium transition-colors ${
          current === "outbound"
            ? "bg-green-600 text-white"
            : "bg-slate-100 text-slate-600"
        }`}
      >
        往 {destTc}
      </button>
      <button
        onClick={() => onChange("inbound")}
        className={`flex-1 rounded-full py-1.5 text-[13px] font-medium transition-colors ${
          current === "inbound"
            ? "bg-green-600 text-white"
            : "bg-slate-100 text-slate-600"
        }`}
      >
        往 {originTc}
      </button>
    </div>
  );
}


function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3.5">
      <div className="text-[16px] font-bold text-green-800 mb-1.5">{title}</div>
      <div className="text-[14px] leading-relaxed text-slate-600 space-y-1.5">{children}</div>
    </div>
  );
}

function HelpView() {
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3.5 text-center">
        <div className="text-[18px] font-bold text-green-800">📖 使用說明</div>
        <div className="text-[13px] text-slate-500 mt-0.5">香港交通即時班次，一個 App 睇晒</div>
      </div>

      <HelpSection title="一、附近偵測">
        <p>打開 App 撳「📍 定位」，App 會以你嘅位置為中心，偵測你預設範圍內（預設 800 米）嘅任何香港交通工具，包括巴士（九巴、城巴、龍運、港鐵巴士）、綠色小巴、大嶼山巴士、港鐵、輕鐵同渡輪（新渡輪、港九小輪、天星小輪），按距離由近至遠排列，每張卡顯示即時班次，每 10 秒自動更新。港鐵、輕鐵站就算收咗車冇班次，張卡都會照顯示（寫明暫無班次），等你知個站喺附近；小巴、嶼巴、渡輪冇班次嗰陣會自動收起，唔會阻住你。撳任何一張卡上面嘅站名，會即刻開 Google 地圖導航，帶你行去嗰個站。</p>
      </HelpSection>

      <div className="bg-amber-50 rounded-2xl border border-amber-200 shadow-sm px-4 py-3.5">
        <div className="text-[16px] font-bold text-amber-700 mb-1.5">⚠️ 重要提醒：範圍以外查唔到</div>
        <div className="text-[14px] leading-relaxed text-amber-800">
          「附近」只會顯示你定位範圍之內嘅交通。如果你身處範圍以外（例如人在外地，或者想查嘅地方離你好遠），附近係唔會顯示到嗰邊嘅交通資訊。呢個時候唔使擔心，用頂部嘅搜尋欄，輸入你想去嘅地方名或者車站名，一樣可以查到嗰度嘅班次（睇下面第四節）。
        </div>
      </div>

      <HelpSection title="二、搜尋範圍">
        <p>附近頁頂部有條滑桿，可以自己調校搜尋範圍，由 200 米至 2000 米，想睇遠啲就拉大啲。</p>
      </HelpSection>

      <HelpSection title="三、營運商選擇">
        <p>搜尋欄下面有兩行營運商 logo：全部、九巴、城巴、港鐵巴士、小巴、嶼巴、鐵路、輕鐵、渡輪。撳邊間，附近列表即刻淨係顯示嗰間公司嘅班次；無論你喺邊個畫面撳，都會即刻跳返去附近頁。撳「全部」就睇返晒。</p>
      </HelpSection>

      <HelpSection title="四、搜尋器點用">
        <p>頂部搜尋欄有三種打法，識用邊種都得：</p>
        <p>1️⃣ <b>打路線號碼</b>：例如想知 968 號巴士幾時有車，打「968」，就會列出嗰條線嘅所有方向。</p>
        <p>2️⃣ <b>打想去嘅地方名</b>：例如打「迪士尼」、「海洋公園」或者「山頂」，會搵出所有去到嗰度嘅路線同車站。</p>
        <p>3️⃣ <b>打車站名</b>：例如打「金鐘」、「太子」，撳入個站，就會一次過睇晒嗰個站所有路線嘅即時班次。</p>
        <p>💡 小貼士：唔使打齊成個名，打頭幾個字已經會出結果；中文、英文都得。撳入任何一條路線，會見到成條線嘅所有站，每一站都有即時班次。</p>
      </HelpSection>

      <HelpSection title="五、我的最愛（★）">
        <p>❤ <b>心心</b>：喺路線詳情頁，每個站都有一粒 ♡。撳一下，就收藏「嗰條線＋嗰個方向＋嗰個站」。之後一開心心頁，就直接見到你成日上車嗰個站嘅即時班次（每 10 秒自動更新），唔使再搵；仲可以用 ▲▼ 調校次序，撳入去係單站專注畫面。</p>
        <p>★ <b>路線</b>：收藏成條路線，隨時撳返出嚟睇全線班次。</p>
        <p>⭐ <b>車站</b>：喺附近頁，巴士站卡右上角有粒星，撳一下收藏成個站，之後會一次過列晒嗰個站所有路線嘅班次。</p>
      </HelpSection>

      <HelpSection title="六、頂部按鈕（任何畫面都喺度）">
        <p>📍 <b>定位</b>：重新偵測你而家嘅位置</p>
        <p>🏠 <b>屋企</b>：即刻返去附近主頁</p>
        <p>🔄 <b>更新</b>：即刻重新載入所有班次資料</p>
        <p><b>あA</b>：放大字體（100% ↔ 150%），撳多下切換返</p>
        <p>❓ <b>使用說明</b>：即係呢一頁，隨時撳返嚟睇</p>
      </HelpSection>

      <HelpSection title="七、資料準確度（老實講）">
        <p>班次全部嚟自運輸署同各營運商嘅官方即時數據。有兩個例外要留意：大嶼山巴士嘅班次係用官方時間表推算；天星小輪官方只提供班次密度，App 會顯示「約 X 分鐘一班（時間表）」，唔係確實開船時間。過境直通巴士因為冇公開數據，同埋電車即時數據未開放，兩樣都暫時未有。</p>
      </HelpSection>

      <HelpSection title="八、其他">
        <p>App 會記住你嘅收藏、字體大小同營運商選擇，下次開返唔使再設定。查詢班次需要網絡連線。</p>
      </HelpSection>

      <div className="bg-slate-100 rounded-2xl px-4 py-3.5">
        <div className="text-[14px] font-bold text-slate-600 mb-1">⚠️ 免責聲明</div>
        <div className="text-[12.5px] leading-relaxed text-slate-500">
          本 App 所顯示之公共交通資訊（包括路線、班次、預計到達時間及服務狀況），乃根據運輸署及各公共交通營運商所提供之資料顯示，僅供參考之用。實際班次及服務可能因交通狀況、天氣或其他原因而有所更改或延誤，詳情以各營運商之最新公佈為準。本 App 並不保證有關資訊之準確性、完整性或即時性；使用者因依賴本 App 之資訊而引致之任何損失、不便或延誤，本 App 概不負責。出門前請預留充足時間，並留意營運商之特別交通安排及公告。
        </div>
      </div>
    </div>
  );
}

export default function LiteApp() {
  const [tab, setTab] = useState<Tab>("nearby");
  const [favTab, setFavTab] = useState<"hearts" | "routes" | "stops">("hearts");
  const [routeQuery, setRouteQuery] = useState("");
  const [searchRadius, setSearchRadius] = useState(800); // meters
  const [operatorFilter, setOperatorFilter] = useState<string>(() => {
    try {
      return localStorage.getItem("hk-bus-eta-op-filter") || "ALL";
    } catch { return "ALL"; }
  });
  const [fontScale, setFontScale] = useState(() => {
    try {
      return Number(localStorage.getItem("hk-bus-eta-font-scale")) || 1;
    } catch { return 1; }
  });
  const cycleFontScale = () => {
    // Two levels only: 100% <-> 150%
    const next = fontScale >= 1.5 ? 1 : 1.5;
    setFontScale(next);
    try { localStorage.setItem("hk-bus-eta-font-scale", String(next)); } catch {}
  };
  const [selectedRoute, setSelectedRoute] = useState<BusRoute | null>(null);
  const [heartFocus, setHeartFocus] = useState<FavoriteRouteStop | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [editOrder, setEditOrder] = useState(false);
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  // CTB direction toggle: CTB search returns one card per route ("Both directions"
  // label), but the API has separate inbound/outbound stop lists. This state
  // tracks which direction the detail view is showing.
  const [ctbBound, setCtbBound] = useState<"outbound" | "inbound">("outbound");
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutate } = useSWRConfig();

  const {
    lat: userLat,
    lng: userLng,
    loading: geoLoading,
    permission,
    requestLocation,
  } = useGeolocation(true);

  const { stops, isLoading: stopsLoading } = useStops();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const { favRoutes, isFavRoute, toggleFavRoute, removeFavRoute } = useFavoriteRoutes();
  const { hearts, isHeart, toggleHeart, removeHeart, moveHeart } = useFavoriteHearts();
  const { routes: searchedRoutes, isLoading: routesLoading } = useRouteSearch(routeQuery);
  const sortedRoutes = useRoutesSortedByDistance(searchedRoutes, userLat, userLng);

  const operatorForApi =
    selectedRoute?.operator === "LWB"
      ? "KMB"
      : selectedRoute?.operator === "MTRT" || selectedRoute?.operator === "LRT"
        ? null // MTRT/LRT handled separately (station-based, not route-based)
        : (selectedRoute?.operator ?? null);
  const { stopSeqs, isLoading: stopsListLoading } = useRouteStops(
    selectedRoute?.route || null,
    operatorForApi as any,
    selectedRoute?.operator === "CTB" ? ctbBound : selectedRoute?.bound || "O",
    selectedRoute?.gmb,
    selectedRoute?.nlb,
    selectedRoute?.ferry
  );

  // Sync CTB direction toggle when a different route is selected:
  // search results have no bound (default outbound); reopened favorites
  // restore their saved bound.
  useEffect(() => {
    if (selectedRoute?.operator === "CTB") {
      setCtbBound(selectedRoute.bound === "inbound" ? "inbound" : "outbound");
    }
  }, [selectedRoute?.id]);

  // Nearby stops within 800m, top 8
  // Nearby: ALL transport within 800m (bus + MTR + Light Rail), no limit, sorted by distance
  const nearby = useNearbyTransport(userLat, userLng, stops, searchRadius);

  const hasLocation = !!userLat && !!userLng;
  const showLocatePrompt = !hasLocation && !geoLoading;

  const handleSelectFavRoute = (fr: FavoriteRoute) => {
    setSelectedRoute({
      id: fr.id,
      route: fr.route,
      operator: fr.operator,
      originTc: fr.originTc,
      originEn: fr.originEn,
      destTc: fr.destTc,
      destEn: fr.destEn,
      directionLabel: fr.directionLabel,
      bound: fr.bound,
      gmb: fr.gmb,
      nlb: fr.nlb,
      ferry: fr.ferry,
    });
    setTab("routes");
  };

  // Tap a route in the nearby ETA list -> jump to its full stop list
  const handleTapEtaRoute = async (eta: ETA) => {
    try {
      const { searchRoutes } = await import("@/utils/static-api");
      const candidates = await searchRoutes(eta.route);
      // Prefer same operator, then match destination
      const sameOp = candidates.filter((r) => r.operator === eta.operator);
      const pool = sameOp.length > 0 ? sameOp : candidates;
      let best: BusRoute | null = null;
      if (eta.destTc) {
        best = pool.find((r) => r.destTc === eta.destTc || r.destEn === eta.destEn) || null;
      }
      if (!best) {
        best =
          pool.find(
            (r) =>
              (eta.destTc && (r.destTc.includes(eta.destTc) || eta.destTc.includes(r.destTc))) ||
              (eta.destEn && (r.destEn.toLowerCase().includes(eta.destEn.toLowerCase()) || eta.destEn.toLowerCase().includes(r.destEn.toLowerCase())))
          ) || null;
      }
      if (!best) best = pool[0] || null;
      if (best) {
        setRouteQuery("");
        setSelectedRoute(best);
        setHighlightSeq(null);
        setTab("routes");
      }
    } catch {
      /* ignore */
    }
  };

  // View MTR/LRT station detail from nearby card
  // Converts NearbyTransport item to BusRoute and shows station ETAs
  const handleViewStation = (item: import("@/hooks/useNearbyTransport").NearbyTransport) => {
    let br: BusRoute | null = null;
    if (item.kind === "mtr" && item.mtrt) {
      br = {
        id: `MTRT-${item.mtrt.line}-${item.mtrt.sta}`,
        operator: "MTRT",
        route: `${item.nameTc}`,
        originTc: item.mtrt.sta,
        originEn: item.mtrt.sta,
        destTc: item.mtrt.lineTc,
        destEn: item.mtrt.lineEn,
        directionLabel: `${item.mtrt.lineTc}`,
        mtrt: {
          line: item.mtrt.line,
          sta: item.mtrt.sta,
          lineTc: item.mtrt.lineTc,
          lineEn: item.mtrt.lineEn,
          staTc: item.nameTc.replace("站", ""),
          staEn: item.nameEn.replace(" Station", ""),
        },
      };
    } else if (item.kind === "lrt" && item.lrt) {
      br = {
        id: `LRT-${item.lrt.stationId}`,
        operator: "LRT",
        route: `${item.lrt.tc}站`,
        originTc: item.lrt.tc,
        originEn: item.lrt.en,
        destTc: "輕鐵",
        destEn: "Light Rail",
        directionLabel: `輕鐵 · ${item.lrt.tc}`,
        lrt: {
          stationId: item.lrt.stationId,
          tc: item.lrt.tc,
          en: item.lrt.en,
        },
      };
    }
    if (br) {
      setRouteQuery("");
      setSelectedRoute(br);
      setHighlightSeq(null);
      setTab("routes");
    }
  };

  // Heart: toggle a specific stop on the current route as "心水站"
  const handleToggleHeart = (route: BusRoute, seq: number, nameTc?: string, nameEn?: string) => {
    toggleHeart({ route, stopSeq: seq, stopNameTc: nameTc || "", stopNameEn: nameEn || "" });
  };

  // Tap a heart favorite -> jump to that route, scrolled to the saved stop
  const handleTapHeart = (h: FavoriteRouteStop) => {
    // Show ONLY this one stop, not the full list
    setRouteQuery("");
    setSelectedRoute(null);
    setHeartFocus(h);
    setHighlightSeq(null);
    setTab("routes");
  };

  const favCount = favorites.length + favRoutes.length + hearts.length;

  return (
    <main className="h-[100dvh] w-full flex flex-col bg-[#FFFBF7] overflow-hidden">
      {/* header - Japanese style */}
      <header className="shrink-0 sticky top-0 z-20 bg-[#FFFBF7] border-b border-[#F5E6D3] px-4 pt-3 pb-2.5">
        {/* Title row */}
        <div className="flex items-baseline justify-between mb-2">
          <h1 className="text-[18px] font-bold text-green-800">{APP_NAME}</h1>
          <span className="text-[12px] text-slate-400 tabular-nums">v{APP_VERSION}</span>
        </div>
        {/* Row 1: Action buttons - always visible */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={requestLocation}
            disabled={geoLoading}
            className="flex flex-col items-center justify-center w-14 h-14 rounded-3xl bg-gradient-to-br from-green-400 to-green-600 text-white shadow-lg shadow-green-200/50 active:scale-95 transition disabled:opacity-60 shrink-0"
            aria-label="定位"
          >
            <LocateFixed className={clsx("w-5 h-5", geoLoading && "animate-pulse")} />
            <span className="text-[10px] font-medium mt-0.5">定位</span>
          </button>
          <button
            onClick={() => {
              setHeartFocus(null);
              setSelectedRoute(null);
              setShowHelp(false);
              setRouteQuery("");
              setTab("nearby");
            }}
            className="flex flex-col items-center justify-center w-14 h-14 rounded-3xl bg-white border border-[#F5E6D3] text-[#8B6F47] shadow-sm active:scale-95 transition shrink-0"
            aria-label="主頁"
          >
            <span className="text-[20px] leading-none">🏠</span>
            <span className="text-[10px] font-medium mt-0.5">屋企</span>
          </button>
          <button
            onClick={() => {
              mutate(() => true);
              if (tab === "nearby") requestLocation();
            }}
            className="flex flex-col items-center justify-center w-14 h-14 rounded-3xl bg-white border border-[#F5E6D3] text-[#8B6F47] shadow-sm active:scale-95 transition shrink-0"
            aria-label="重新整理"
          >
            <RefreshCw className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-0.5">更新</span>
          </button>
          <button
            onClick={cycleFontScale}
            className="flex flex-col items-center justify-center w-14 h-14 rounded-3xl bg-white border border-[#F5E6D3] text-[#8B6F47] shadow-sm active:scale-95 transition shrink-0"
            aria-label="字體大小"
            title={`字體: ${Math.round(fontScale * 100)}%`}
          >
            <span className="text-[16px] font-bold leading-none">あA</span>
            <span className="text-[10px] font-medium mt-0.5">{Math.round(fontScale * 100)}%</span>
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="flex flex-col items-center justify-center w-14 h-14 rounded-3xl bg-white border border-[#F5E6D3] text-[#8B6F47] shadow-sm active:scale-95 transition shrink-0"
            aria-label="使用說明"
          >
            <span className="text-[20px] leading-none">❓</span>
            <span className="text-[10px] font-medium mt-0.5">使用說明</span>
          </button>
          {(heartFocus || selectedRoute || showHelp) && (
            <button
              onClick={() => {
                setHeartFocus(null);
                setSelectedRoute(null);
                setShowHelp(false);
              }}
              className="flex items-center justify-center h-14 px-4 rounded-3xl bg-[#FFF5E6] border border-[#F5E6D3] text-[#8B6F47] text-[14px] font-medium active:scale-95 transition shrink-0"
              aria-label="返回"
            >
              ← 返回
            </button>
          )}
        </div>
        {/* Row 2: Search bar - independent full-width row */}
        <div className="relative mt-2.5">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#C4A77D]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="最強搜尋器可輸入目的地及巴士小巴號碼"
            value={routeQuery}
            onChange={(e) => {
              setRouteQuery(e.target.value);
              setShowHelp(false);
              setTab("routes");
              setSelectedRoute(null);
              setHeartFocus(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                inputRef.current?.blur();
              }
            }}
            className="w-full h-12 pl-12 pr-11 rounded-full bg-white border-2 border-[#F5E6D3] text-[16px] text-[#4A3728] placeholder:text-[#C4A77D] placeholder:text-[14px] focus:outline-none focus:border-green-300 focus:ring-4 focus:ring-green-100/50 shadow-sm"
          />
          {routeQuery ? (
            <button
              onClick={() => {
                setRouteQuery("");
                setSelectedRoute(null);
                setHeartFocus(null);
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[#F5E6D3] flex items-center justify-center text-[#8B6F47]"
              aria-label="清除"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => {
                inputRef.current?.blur();
                if (routeQuery.trim()) {
                  setTab("routes");
                  setHeartFocus(null);
                  setSelectedRoute(null);
                }
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white shadow-md"
              aria-label="搜尋"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Operator filter - logo buttons, two rows, no scrolling */}
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {(
            [
              { id: "ALL", label: "全部", logo: null },
              { id: "KMB", label: "九巴", logo: "logos/kmb.svg" },
              { id: "CTB", label: "城巴", logo: "logos/ctb.svg" },
              { id: "MTR", label: "港鐵巴士", logo: "logos/mtr.svg" },
              { id: "GMB", label: "小巴", logo: "logos/gmb.svg" },
              { id: "NLB", label: "嶼巴", logo: null },
              { id: "MTRT", label: "鐵路", logo: null },
              { id: "LRT", label: "輕鐵", logo: "logos/lrt.svg" },
              { id: "FERRY", label: "渡輪", logo: null },
            ] as const
          ).map((o) => {
            const active = operatorFilter === o.id;
            return (
              <button
                key={o.id}
                onClick={() => {
                  setOperatorFilter(o.id);
                  try { localStorage.setItem("hk-bus-eta-op-filter", o.id); } catch {}
                  // Immediate jump: leave any detail view and go to nearby list,
                  // where the filter takes effect right away
                  setSelectedRoute(null);
                  setHeartFocus(null);
                  setShowHelp(false);
                  setTab("nearby");
                }}
                className={clsx(
                  "flex flex-col items-center justify-center w-[66px] py-1.5 rounded-2xl border active:scale-95 transition-all",
                  active
                    ? "bg-white border-green-500 ring-2 ring-green-200 shadow-md"
                    : "bg-white/70 border-[#F5E6D3] opacity-60"
                )}
                aria-label={`只睇${o.label}`}
                aria-pressed={active}
              >
                <span className="h-[20px] flex items-center justify-center">
                  {o.id === "ALL" ? (
                    <span className="text-[14px] font-bold text-slate-600">ALL</span>
                  ) : o.id === "MTRT" ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#8e44ad] text-white">鐵路</span>
                  ) : o.id === "NLB" ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#0077b6] text-white">嶼巴</span>
                  ) : o.id === "FERRY" ? (
                    <span className="text-[17px] leading-none">⛴️</span>
                  ) : o.logo ? (
                    <img src={o.logo} alt={o.label} className="h-[20px] w-auto rounded" />
                  ) : null}
                </span>
                <span className={clsx("text-[11px] font-medium whitespace-nowrap mt-0.5", active ? "text-green-700" : "text-slate-500")}>
                  {o.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* tabs - Japanese style */}
        <div className="flex p-1.5 bg-[#FFF5E6] border border-[#F5E6D3] rounded-full mt-2.5 shadow-sm">
          {(
            [
              { id: "nearby", label: "附近", icon: MapPin },
              { id: "routes", label: "路線", icon: Bus },
              { id: "favorites", label: `★ ${favCount}`, icon: Star },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => { setShowHelp(false); setTab(t.id as Tab); }}
              className={clsx(
                "flex-1 py-2.5 text-[14px] font-medium rounded-full transition-all flex items-center justify-center gap-1.5",
                tab === t.id
                  ? "bg-gradient-to-br from-green-400 to-green-600 text-white shadow-md shadow-green-200/50"
                  : "text-[#8B6F47]"
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <div className="space-y-3" style={{ zoom: fontScale } as any}>
        {showHelp && <HelpView />}
        {!showHelp && tab === "nearby" && (
          <>
            {/* Distance slider */}
            {!showLocatePrompt && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[14px] font-medium text-slate-700">搜尋範圍</span>
                  <span className="text-[14px] font-bold text-green-600 tabular-nums">{searchRadius} 米</span>
                </div>
                <input
                  type="range"
                  min={200}
                  max={2000}
                  step={100}
                  value={searchRadius}
                  onChange={(e) => setSearchRadius(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                />
                <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                  <span>200米</span>
                  <span>2000米</span>
                </div>
              </div>
            )}
            {showLocatePrompt && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <Navigation className="w-7 h-7 text-green-600" />
                </div>
                <h2 className="font-semibold text-slate-900 text-[17px] mb-1">
                  撳一下，即刻睇附近有咩車
                </h2>
                <p className="text-[14px] text-slate-500 mb-4">
                  定位後自動列出 800 米內所有車站＋實時班次
                </p>
                <button
                  onClick={requestLocation}
                  className="px-6 py-3 rounded-2xl bg-green-600 text-white font-semibold text-[17px] shadow-md shadow-green-500/25 active:scale-95 transition"
                >
                  📍 定位我嘅位置
                </button>
              </div>
            )}

            {geoLoading && (
              <div className="bg-white rounded-2xl p-6 text-center text-[15px] text-slate-500">
                定位緊…
              </div>
            )}

            {hasLocation && stopsLoading && (
              <div className="bg-white rounded-2xl p-6 text-center text-[15px] text-slate-500">
                載入車站資料緊…
              </div>
            )}

            {hasLocation && !stopsLoading && nearby.length === 0 && (
              <div className="bg-white rounded-2xl p-6 text-center">
                <p className="text-[15px] text-slate-500">
                  {searchRadius} 米內冇車站紀錄
                  <br />
                  試下用上面搜尋路線
                </p>
              </div>
            )}

            {operatorFilter !== "ALL" && hasLocation && (
              <div className="text-center text-[13px] text-[#8B6F47] py-1">
                而家只顯示「{ { KMB: "九巴", CTB: "城巴", MTR: "港鐵巴士", GMB: "小巴", NLB: "嶼巴", FERRY: "渡輪", MTRT: "鐵路", LRT: "輕鐵" }[operatorFilter] || operatorFilter }」，撳「全部」睇返晒
              </div>
            )}
            {nearby
              .filter((item) => {
                if (operatorFilter === "ALL") return true;
                if (operatorFilter === "MTRT") return item.kind === "mtr";
                if (operatorFilter === "LRT") return item.kind === "lrt";
                if (operatorFilter === "GMB") return item.kind === "gmb" || item.kind === "bus";
                if (operatorFilter === "NLB") return item.kind === "nlb";
                if (operatorFilter === "FERRY") return item.kind === "ferry";
                return item.kind === "bus"; // KMB / CTB / MTR Bus live on bus cards
              })
              .map((item, i) => (
                <NearbyTransportCard
                  key={item.id}
                  item={item}
                  defaultExpanded={i === 0}
                  onTapRoute={handleTapEtaRoute}
                  onViewStation={handleViewStation}
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  operatorFilter={operatorFilter === "ALL" ? undefined : operatorFilter}
                />
              ))}
          </>
        )}

        {!showHelp && tab === "routes" && (
          <>
            {!routeQuery && !selectedRoute && !heartFocus && (
              <div className="bg-white rounded-2xl p-6 text-center text-[15px] text-slate-500">
                喺上面輸入路線編號搜尋
                <br />
                <span className="text-[13px]">支援九巴、城巴、綠Van、港鐵巴士、港鐵、輕鐵</span>
              </div>
            )}

            {heartFocus ? (
              <HeartFocusView heart={heartFocus} onBack={() => setHeartFocus(null)} />
            ) : selectedRoute ? (
              <div>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <OperatorBadge operator={selectedRoute.operator} />
                      <span className="font-bold text-slate-900 text-[17px]">
                        {selectedRoute.route}
                      </span>
                      {selectedRoute.directionLabel && (
                        <span className="text-[13px] text-slate-500">
                          {selectedRoute.directionLabel}
                        </span>
                      )}
                    </div>
                    <div className="text-[14px] text-slate-500 truncate mt-0.5">
                      {selectedRoute.operator === "CTB" && ctbBound === "inbound"
                        ? `${selectedRoute.destTc} → ${selectedRoute.originTc}`
                        : `${selectedRoute.originTc} → ${selectedRoute.destTc}`}
                    </div>
                    {selectedRoute.operator === "CTB" && (
                      <CtbDirectionToggle
                        route={selectedRoute.route}
                        originTc={selectedRoute.originTc}
                        destTc={selectedRoute.destTc}
                        current={ctbBound}
                        onChange={setCtbBound}
                      />
                    )}
                  </div>
                  <button
                    onClick={() => {
                      const favId =
                        selectedRoute.operator === "CTB"
                          ? `CTB-${selectedRoute.route}-${ctbBound}`
                          : selectedRoute.id;
                      const isFav = isFavRoute(favId);
                      if (isFav) {
                        removeFavRoute(favId);
                      } else {
                        toggleFavRoute(
                          selectedRoute.operator === "CTB"
                            ? {
                                ...selectedRoute,
                                id: favId,
                                bound: ctbBound,
                                // Sync origin/dest labels to the toggled direction
                                ...(ctbBound === "inbound"
                                  ? {
                                      originTc: selectedRoute.destTc,
                                      originEn: selectedRoute.destEn,
                                      destTc: selectedRoute.originTc,
                                      destEn: selectedRoute.originEn,
                                      directionLabel: `往 ${selectedRoute.originTc}`,
                                    }
                                  : {
                                      directionLabel: `往 ${selectedRoute.destTc}`,
                                    }),
                              }
                            : selectedRoute
                        );
                      }
                    }}
                    className="p-2 shrink-0"
                    aria-label="收藏路線"
                  >
                    {isFavRoute(
                      selectedRoute.operator === "CTB"
                        ? `CTB-${selectedRoute.route}-${ctbBound}`
                        : selectedRoute.id
                    ) ? (
                      <Star className="w-6 h-6 text-amber-400 fill-amber-400" />
                    ) : (
                      <StarOff className="w-6 h-6 text-slate-300" />
                    )}
                  </button>
                </div>

                {(selectedRoute as any).isStopResult ? (
                  <div className="mt-3">
                    <StopSearchResultETAs stop={(selectedRoute as any).stopData} />
                  </div>
                ) : selectedRoute.operator === "MTRT" ? (
                  <div className="mt-3">
                    <MTRTStationETAs route={selectedRoute} />
                  </div>
                ) : selectedRoute.operator === "LRT" ? (
                  <div className="mt-3">
                    <LRTStationETAs route={selectedRoute} />
                  </div>
                ) : stopsListLoading ? (
                  <div className="bg-white rounded-2xl p-6 mt-3 text-center text-[15px] text-slate-500">
                    載入站表緊…
                  </div>
                ) : (
                  <LiteRouteStopsList
                    route={selectedRoute}
                    stopSeqs={stopSeqs}
                    stops={stops}
                    isHeart={isHeart}
                    onToggleHeart={handleToggleHeart}
                    highlightSeq={highlightSeq}
                  />
                )}
              </div>
            ) : (
              routeQuery && (
                <div className="space-y-2">
                  {routesLoading && (
                    <div className="text-center text-[14px] text-slate-400 py-4">
                      搜尋緊…
                    </div>
                  )}
                  {!routesLoading && sortedRoutes.length === 0 && (
                    <div className="bg-white rounded-2xl p-6 text-center text-[15px] text-slate-500">
                      搵唔到「{routeQuery}」
                    </div>
                  )}
                  {sortedRoutes.map((r) => (
                    <div
                      key={r.id}
                      className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3"
                    >
                      <button
                        onClick={() => setSelectedRoute(r)}
                        className="flex-1 min-w-0 text-left flex items-center gap-2.5"
                      >
                        <OperatorBadge operator={r.operator} />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-[17px]">
                            {r.route}
                            {r.directionLabel && (
                              <span className="ml-2 text-[13px] font-medium text-slate-500">
                                {r.directionLabel}
                              </span>
                            )}
                          </div>
                          <div className="text-[14px] text-slate-500 truncate">
                            {r.originTc} → {r.destTc}
                          </div>
                          {r.originEn && (
                            <div className="text-[12px] text-slate-400 truncate">
                              {r.originEn} → {r.destEn}
                            </div>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={() => toggleFavRoute(r)}
                        className="p-2 shrink-0"
                        aria-label={isFavRoute(r.id) ? "取消收藏" : "收藏路線"}
                      >
                        {isFavRoute(r.id) ? (
                          <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
                        ) : (
                          <StarOff className="w-5 h-5 text-slate-300" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}

        {!showHelp && tab === "favorites" && (
          <>
            <div className="flex p-1 bg-white rounded-2xl border border-slate-100">
              {(["hearts", "routes", "stops"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setFavTab(t); setEditOrder(false); }}
                  className={clsx(
                    "flex-1 py-2 text-[14px] font-medium rounded-xl transition-all flex items-center justify-center gap-1",
                    favTab === t
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-500"
                  )}
                >
                  {t === "hearts" ? (
                    <><Heart className="w-3.5 h-3.5 text-green-600 fill-green-600" /> 心心 ({hearts.length})</>
                  ) : t === "routes" ? (
                    <>★ 路線 ({favRoutes.length})</>
                  ) : (
                    <>★ 車站 ({favorites.length})</>
                  )}
                </button>
              ))}
            </div>
            {favTab === "hearts" && hearts.length > 1 && (
              <div className="flex justify-end mt-2">
                <button
                  onClick={() => setEditOrder(!editOrder)}
                  className={editOrder
                    ? "text-[14px] font-medium px-3 py-1.5 rounded-full bg-green-600 text-white"
                    : "text-[14px] font-medium px-3 py-1.5 rounded-full bg-white text-green-600 border border-green-200"}
                >
                  {editOrder ? "✓ 完成排序" : "✎ 編輯次序"}
                </button>
              </div>
            )}

            {favTab === "hearts" && (
              <div className="space-y-2">
                {hearts.length === 0 && (
                  <div className="bg-white rounded-2xl p-6 text-center text-[15px] text-slate-500">
                    未有心水站
                    <br />
                    <span className="text-[13px]">入去任何路線嘅站表，撳每站右邊嘅 ♡ 收藏你成日上車嗰個站</span>
                  </div>
                )}
                {hearts.map((h, idx) => (
                  <HeartListItem
                    key={h.id}
                    heart={h}
                    index={idx}
                    total={hearts.length}
                    editOrder={editOrder}
                    onTap={() => handleTapHeart(h)}
                    onRemove={() => removeHeart(h.id)}
                    onMove={(dir) => moveHeart(h.id, dir)}
                  />
                ))}
              </div>
            )}

            {favTab === "routes" && (
              <div className="space-y-2">
                {favRoutes.length === 0 && (
                  <div className="bg-white rounded-2xl p-6 text-center text-[15px] text-slate-500">
                    未收藏任何路線
                    <br />
                    <span className="text-[13px]">去「路線」搜尋，撳星號收藏</span>
                  </div>
                )}
                {favRoutes.map((fr) => (
                  <div
                    key={fr.id}
                    className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3"
                  >
                    <button
                      onClick={() => handleSelectFavRoute(fr)}
                      className="flex-1 min-w-0 text-left flex items-center gap-2.5"
                    >
                      <OperatorBadge operator={fr.operator} />
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-[17px]">
                          {fr.route}
                          {fr.directionLabel && (
                            <span className="ml-2 text-[13px] font-medium text-slate-500">
                              {fr.directionLabel}
                            </span>
                          )}
                        </div>
                        <div className="text-[14px] text-slate-500 truncate">
                          {fr.originTc} → {fr.destTc}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => removeFavRoute(fr.id)}
                      className="p-2 shrink-0"
                      aria-label="取消收藏"
                    >
                      <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {favTab === "stops" && (
              <div className="space-y-2">
                {favorites.length === 0 && (
                  <div className="bg-white rounded-2xl p-6 text-center border border-[#F5E6D3]">
                    <div className="text-[40px] mb-2">⭐</div>
                    <div className="text-[15px] text-[#4A3728] font-medium mb-1">未收藏任何車站</div>
                    <div className="text-[13px] text-[#8B6F47] leading-relaxed">
                      去「附近」頁，撳每張巴士站卡右上角嘅 ⭐<br />就可以收藏成日用嘅車站
                    </div>
                    <button
                      onClick={() => setTab("nearby")}
                      className="mt-3 px-5 py-2 rounded-full bg-gradient-to-br from-green-400 to-green-600 text-white text-[14px] font-medium shadow-md"
                    >
                      去附近睇下
                    </button>
                  </div>
                )}
                {favorites.map((f) => {
                  const fullStop: BusStop = {
                    id: f.id,
                    originalIds: [],
                    nameEn: f.nameEn,
                    nameTc: f.nameTc,
                    lat: f.lat,
                    lng: f.lng,
                  };
                  return (
                    <NearbyStopCard
                      key={f.id}
                      stop={fullStop}
                      distance={0}
                      isFavorite={isFavorite}
                      toggleFavorite={toggleFavorite}
                      defaultExpanded={false}
                      onTapRoute={handleTapEtaRoute}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
        </div>
      </div>

      {/* footer: link to map version */}
      <footer className="shrink-0 bg-white border-t border-slate-200 px-4 py-2 flex items-center justify-between">
        <span className="text-[12px] text-slate-400">{APP_NAME} v{APP_VERSION}</span>
      </footer>
    </main>
  );
}