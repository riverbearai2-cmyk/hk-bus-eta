"use client";

import { useState } from "react";
import useSWR from "swr";
import { getETAs } from "@/utils/static-api";
import type { ETA, BusStop } from "@/types/bus";
import type { NearbyTransport } from "@/hooks/useNearbyTransport";
import { clsx } from "clsx";
import { ChevronDown, Star, StarOff, Navigation } from "lucide-react";
import { OperatorBadge } from "./LiteApp";

function etaText(e: ETA): string {
  // 2026-10-29: a bare "-" remark (LRT API lists a train with no predicted
  // time) used to render as just "-"; label it honestly instead. Real
  // remarks (e.g. 未開出) are preserved.
  if (e.etaMinutes === null) {
    const r = e.remarkTc || e.remarkEn;
    return r && r !== "-" ? r : "時間待定";
  }
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

function isUrgent(e: ETA): boolean {
  return e.etaMinutes !== null && e.etaMinutes <= 3 && e.etaMinutes >= 0;
}

function KindBadge({ kind }: { kind: string }) {
  if (kind === "mtr") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#8e44ad] text-white shrink-0">
        鐵路
      </span>
    );
  }
  if (kind === "lrt") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#e67e22] text-white shrink-0">
        輕鐵
      </span>
    );
  }
  if (kind === "gmb") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-600 text-white shrink-0">
        小巴
      </span>
    );
  }
  if (kind === "ferry") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-600 text-white shrink-0">
        渡輪
      </span>
    );
  }
  if (kind === "nlb") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#0077b6] text-white shrink-0">
        嶼巴
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-500 text-white shrink-0">
      巴士站
    </span>
  );
}

/**
 * Unified nearby card for bus stops, MTR stations, and Light Rail stops.
 * Fetches ETAs based on kind.
 */
export function NearbyTransportCard({
  item,
  defaultExpanded,
  onTapRoute,
  onViewStation,
  isFavorite,
  toggleFavorite,
  operatorFilter,
}: {
  item: NearbyTransport;
  defaultExpanded: boolean;
  onTapRoute: (eta: ETA) => void;
  onViewStation?: (item: NearbyTransport) => void;
  isFavorite?: (id: string) => boolean;
  toggleFavorite?: (stop: any) => void;
  operatorFilter?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Fetch ETAs based on kind
  const swrKey =
    item.kind === "bus" && item.busStop
      ? ["nearby-bus", item.id]
      : item.kind === "mtr" && item.mtrt
        ? ["nearby-mtr", item.mtrt.line, item.mtrt.sta]
        : item.kind === "lrt" && item.lrt
          ? ["nearby-lrt", item.lrt.stationId]
          : item.kind === "gmb" && item.gmb
          ? ["nearby-gmb", item.gmb.route_id, item.gmb.route_seq, item.gmb.stop_seq]
          : null;

  const { data: etas, isLoading } = useSWR<any[]>(
    swrKey,
    async () => {
      if (item.kind === "bus" && item.busStop) {
        // Use getAllETAsForStop for bus (includes cross-operator).
        // Merged duplicate records: query every record, then dedupe so the
        // same bus appearing via two registrations shows only once.
        const { getAllETAsForStop } = await import("@/utils/static-api");
        const stops = [item.busStop, ...(item.mergedStops || [])];
        if (stops.length === 1) return getAllETAsForStop(stops[0]);
        const results = await Promise.all(
          stops.map((s) => getAllETAsForStop(s).catch(() => [] as any[]))
        );
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const list of results) {
          for (const e of list) {
            const key = `${e.operator}-${e.route}-${e.destEn}-${e.etaMinutes}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(e);
          }
        }
        merged.sort((a, b) => {
          if (a.etaMinutes === null) return 1;
          if (b.etaMinutes === null) return -1;
          return a.etaMinutes - b.etaMinutes;
        });
        return merged;
      } else if (item.kind === "mtr" && item.mtrt) {
        // Direct fetch for MTR (bypass getETAs)
        try {
          const res = await fetch(
            `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${item.mtrt.line}&sta=${item.mtrt.sta}&lang=TC`
          ).then((r) => r.json());
          if (res.status === 1 && res.data) {
            const key = `${item.mtrt.line}-${item.mtrt.sta}`;
            const stationData = res.data[key];
            if (stationData) {
              const trains = [];
              for (const dir of ["UP", "DOWN"]) {
                const list = stationData[dir] || [];
                for (const t of list.slice(0, 4)) {
                  if (t.valid !== "Y") continue;
                  const curr = new Date(stationData.curr_time.replace(" ", "T"));
                  const arr = new Date(t.time.replace(" ", "T"));
                  const mins = Math.max(0, Math.round((arr.getTime() - curr.getTime()) / 60000));
                  trains.push({
                    id: `mtrt-${item.mtrt.line}-${item.mtrt.sta}-${dir}-${t.seq}`,
                    operator: "MTRT" as const,
                    route: item.mtrt.lineTc,
                    destEn: t.dest,
                    destTc: t.dest,
                    eta: t.time,
                    etaMinutes: mins,
                    remarkEn: `Plat ${t.plat}`,
                    remarkTc: `${t.plat}號月台`,
                    platform: t.plat ? String(t.plat) : undefined,
                    sequence: trains.length + 1,
                    isRealtime: true,
                  });
                }
              }
              return trains;
            }
          }
        } catch (e) {
          console.error("MTR fetch failed:", e);
        }
        return [];
      } else if (item.kind === "lrt" && item.lrt) {
        // Direct fetch for LRT (bypass getETAs to avoid issues)
        try {
          const res = await fetch(
            `https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule?station_id=${item.lrt.stationId}`
          ).then((r) => r.json());
          if (res.status === 1 && res.platform_list) {
            const trains = [];
            for (const plat of res.platform_list) {
              for (const route of plat.route_list || []) {
                const timeStr = route.time_ch || route.time_en || "-";
                let mins = null;
                const m = timeStr.match(/(\d+)/);
                if (m) mins = parseInt(m[1], 10);
                if (timeStr.includes("即將") || timeStr.includes("埋站") || timeStr.toLowerCase().includes("arriving")) mins = 0;
                trains.push({
                  id: `lrt-${item.lrt.stationId}-${plat.platform_id}-${route.route_no}`,
                  operator: "LRT" as const,
                  route: `${route.route_no}號`,
                  destEn: route.dest_en || "",
                  destTc: route.dest_ch || "",
                  eta: null,
                  etaMinutes: mins,
                  remarkEn: route.time_en || undefined,
                  remarkTc: route.time_ch || undefined,
                  platform: plat.platform_id ? String(plat.platform_id) : undefined,
                  sequence: trains.length + 1,
                  isRealtime: true,
                });
              }
            }
            // Sort by time across BOTH directions (RB3, 2026-10-24):
            // the API returns platform-by-platform (direction-grouped),
            // but the card must show the soonest departure on top.
            // Unknown ("-") departures go last; stable sort keeps
            // platform order within equal minutes.
            trains.sort((a: any, b: any) => {
              if (a.etaMinutes === null && b.etaMinutes === null) return 0;
              if (a.etaMinutes === null) return 1;
              if (b.etaMinutes === null) return -1;
              return a.etaMinutes - b.etaMinutes;
            });
            trains.forEach((t: any, i: number) => { t.sequence = i + 1; });
            return trains;
          }
        } catch (e) {
          console.error("LRT fetch failed:", e);
        }
        return [];
      } else if (item.kind === "gmb" && item.gmb) {
        // Direct GMB fetch via proxy
        try {
          const res = await fetch(
            `https://hengfuk-gmb-proxy-riverbearai2-1543.vercel.app/api/gmb-proxy?path=eta/route-stop/${item.gmb.route_id}/${item.gmb.route_seq}/${item.gmb.stop_seq}`
          ).then((r) => r.json());
          const list = res?.data?.eta || [];
          return list.map((e: any, idx: number) => ({
            id: `gmb-${item.gmb!.route_id}-${item.gmb!.route_seq}-${e.eta_seq}`,
            operator: "GMB" as const,
            route: item.gmb!.code,
            destEn: item.gmb!.dest_en,
            destTc: item.gmb!.dest_tc,
            eta: e.timestamp,
            etaMinutes: e.diff,
            remarkEn: e.remarks_en,
            remarkTc: e.remarks_tc,
            sequence: idx + 1,
            isRealtime: e.remarks_tc !== "未開出",
          }));
        } catch (e) {
          console.error("GMB fetch failed:", e);
        }
        return [];
      } else if (item.kind === "nlb" && item.nlb) {
        // Direct NLB fetch (official API, CORS *)
        try {
          const res = await fetch(
            `https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrivals&routeId=${item.nlb.routeId}&stopId=${item.nlb.stopId}&language=zh`
          ).then((r) => r.json());
          const list = res?.estimatedArrivals || [];
          const now = Date.now();
          return list
            .filter((e: any) => e.estimatedArrivalTime)
            .map((e: any, idx: number) => {
              const t = new Date(String(e.estimatedArrivalTime).replace(" ", "T")).getTime();
              return {
                id: `nlb-${item.nlb!.routeId}-${item.nlb!.stopId}-${idx}`,
                operator: "NLB" as const,
                route: item.nlb!.routeNo,
                destEn: item.nlb!.dest_en,
                destTc: item.nlb!.dest_tc,
                eta: e.estimatedArrivalTime,
                etaMinutes: Math.max(0, Math.round((t - now) / 60000)),
                remarkEn: e.routeVariantName || undefined,
                remarkTc: e.routeVariantName || undefined,
                sequence: idx + 1,
                isRealtime: String(e.noGPS) === "1",
              };
            });
        } catch (e) {
          console.error("NLB fetch failed:", e);
        }
        return [];
      } else if (item.kind === "ferry" && item.ferry) {
        // Ferry ETAs via shared helper (Sun/HKKF live APIs, Star frequency table)
        try {
          const { getFerryETAs } = await import("@/utils/static-api");
          return getFerryETAs(item.ferry);
        } catch (e) {
          console.error("Ferry fetch failed:", e);
        }
        return [];
      }
      return [];
    },
    {
      refreshInterval: 10000,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  // Hide GMB cards with no ETAs (user doesn't want clutter)
  if (item.kind === "gmb" && !isLoading && (!etas || etas.length === 0)) {
    return null;
  }
  // Hide NLB cards with no ETAs (sparse service, avoid clutter)
  if (item.kind === "nlb" && !isLoading && (!etas || etas.length === 0)) {
    return null;
  }
  // Hide ferry cards with no upcoming sailing
  if (item.kind === "ferry" && !isLoading && (!etas || etas.length === 0)) {
    return null;
  }

  // Operator filter: only show ETAs from the chosen operator
  const filteredEtas = operatorFilter
    ? (etas || []).filter((e: any) =>
        operatorFilter === "FERRY"
          ? ["SUNFERRY", "HKKF", "STARFERRY"].includes(e.operator)
          : e.operator === operatorFilter
      )
    : etas || [];
  // Hide the whole card when a filter is on and this stop has none of that operator.
  // EXCEPTION: MTR/LRT station cards ARE the operator — with no service (e.g.
  // after last train) the station must still appear showing 暫無班次， so the
  // user can see the station is nearby (RB3 at Sam Shing, 2026-10-21).
  if (
    operatorFilter &&
    !isLoading &&
    etas &&
    filteredEtas.length === 0 &&
    item.kind !== "mtr" &&
    item.kind !== "lrt"
  ) {
    return null;
  }

  // Homepage rule (RB3, 2026-10-24): every card sorts by time across
  // ALL directions, so the collapsed card always shows the fastest
  // departures without tapping in. Unknown ("-") departures go last;
  // stable sort keeps source order within equal minutes. This one
  // place covers bus, MTR, LRT, GMB, NLB and ferries (LRT/MTR branches
  // used to be direction-grouped from their APIs).
  const sortedEtas = [...filteredEtas].sort((a: any, b: any) => {
    if (a.etaMinutes === null && b.etaMinutes === null) return 0;
    if (a.etaMinutes === null) return 1;
    if (b.etaMinutes === null) return -1;
    return a.etaMinutes - b.etaMinutes;
  });
  const shown = expanded ? sortedEtas : sortedEtas.slice(0, 4);
  const distText =
    item.dist < 1000 ? `${Math.round(item.dist)}m` : `${(item.dist / 1000).toFixed(1)}km`;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 active:bg-slate-50"
      >
        <div
          className="min-w-0 flex-1 cursor-pointer"
          role="button"
          aria-label={`喺 Google 地圖導航去 ${item.nameTc}`}
          title="撳一下開 Google 地圖導航去呢個站"
          onClick={(e) => {
            e.stopPropagation();
            window.open(
              `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}&travelmode=walking`,
              "_blank"
            );
          }}
        >
          <div className="flex items-center gap-2">
            <KindBadge kind={item.kind} />
            <span className="font-semibold text-slate-900 text-[17px] truncate">
              {item.nameTc}
            </span>
            <span className="text-[12px] text-green-600 font-medium tabular-nums shrink-0">
              {distText}
            </span>
            <Navigation className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          </div>
          {item.nameEn && (
            <div className="text-[13px] text-slate-400 truncate mt-0.5">{item.nameEn}</div>
          )}
          {item.kind === "mtr" && item.mtrt && (
            <div className="text-[12px] text-purple-600 mt-0.5">{item.mtrt.lineTc}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {item.kind === "bus" && isFavorite && toggleFavorite && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite({
                  id: item.id,
                  nameTc: item.nameTc,
                  nameEn: item.nameEn,
                  lat: item.lat,
                  lng: item.lng,
                });
              }}
              className="p-1.5 rounded-full active:scale-90 transition"
              aria-label={isFavorite(item.id) ? "取消收藏" : "收藏車站"}
            >
              {isFavorite(item.id) ? (
                <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
              ) : (
                <Star className="w-5 h-5 text-slate-300" />
              )}
            </button>
          )}
          <ChevronDown
            className={clsx(
              "w-5 h-5 text-slate-400 transition-transform",
              expanded && "rotate-180"
            )}
          />
        </div>
      </button>

      <div className="px-4 pb-3">
        {isLoading ? (
          <div className="text-[14px] text-slate-400 py-2">載入班次中…</div>
        ) : !etas || etas.length === 0 ? (
          <div className="text-[14px] text-slate-400 py-2">暫無班次</div>
        ) : (
          <div className="space-y-1.5">
            {shown.map((e, i) => (
              <button
                key={i}
                onClick={() => {
                  // For bus/GMB: tap ETA -> go to route's full stop list
                  // For MTR/LRT: tap ETA -> go to station detail view
                  if ((item.kind === "mtr" || item.kind === "lrt") && onViewStation) {
                    onViewStation(item);
                  } else {
                    onTapRoute(e);
                  }
                }}
                className="w-full flex items-center gap-2 py-1.5 text-left active:bg-green-50 rounded-lg px-1"
              >
                <OperatorBadge operator={e.operator} />
                <span className="font-bold text-green-700 text-[15px] underline decoration-green-200 underline-offset-2 shrink-0">
                  {e.route}
                </span>
                <span className="text-[13px] text-slate-500 truncate flex-1">
                  往 {e.destTc || e.destEn}
                </span>
                {(item.kind === "mtr" || item.kind === "lrt") && e.platform && (
                  <span className="text-[12px] text-slate-400 shrink-0">{e.platform}號月台</span>
                )}
                <span
                  className={clsx(
                    "text-[14px] font-semibold tabular-nums shrink-0",
                    etaColor(e),
                    isUrgent(e) && "eta-urgent"
                  )}
                >
                  {etaText(e)}
                </span>
              </button>
            ))}
            {!expanded && filteredEtas.length > 4 && (
              <div className="text-[12px] text-slate-400 text-center pt-1">
                仲有 {filteredEtas.length - 4} 班…撳入去睇晒
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
