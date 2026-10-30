"use client";

import useSWR from "swr";
import { getETAs } from "@/utils/static-api";
import type { FavoriteRouteStop, BusRoute } from "@/types/bus";
import { LRTStationETAs } from "./LRTStationETAs";
import { MTRTStationETAs } from "./MTRTStationETAs";
import { OperatorBadge } from "./LiteApp";
import { clsx } from "clsx";

export function HeartFocusView({
  heart,
  onBack,
}: {
  heart: FavoriteRouteStop;
  onBack: () => void;
}) {
  const { data: etas, isLoading } = useSWR(
    ["heart-eta", heart.id],
    async () => {
      const { getRouteStops, getETAs } = await import("@/utils/static-api");
      // getRouteStops(route, operator, bound, gmbMeta)
      const stops = await getRouteStops(
        heart.route,
        heart.operator as any,
        heart.bound || "O",
        heart.gmb,
        heart.nlb,
        heart.ferry
      );
      const stop = stops[heart.stopSeq - 1];
      if (!stop) return [];
      // For GMB, need gmb metadata
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
      if (heart.operator === "NLB" && heart.nlb) {
        return getETAs({
          operator: "NLB",
          nlb: {
            routeId: heart.nlb.routeId,
            stopId: Number(stop.stop),
            routeNo: heart.route,
            dest_tc: heart.destTc,
            dest_en: heart.destEn,
          },
        } as any);
      }
      return getETAs({
        operator: heart.operator as any,
        stopId: stop.stop,
        route: heart.route,
      } as any);
    },
    { refreshInterval: 10000, revalidateOnFocus: false, dedupingInterval: 5000 }
  );

  // For LRT/MTRT hearts, show station ETAs directly
  if (heart.operator === "LRT" && heart.lrt) {
    const route: BusRoute = {
      id: `LRT-${heart.lrt.stationId}`,
      route: heart.route,
      operator: "LRT",
      originTc: "",
      originEn: "",
      destTc: heart.destTc,
      destEn: heart.destEn,
      lrt: heart.lrt,
    };
    return <LRTStationETAs route={route} />;
  }
  if (heart.operator === "MTRT" && heart.mtrt) {
    const route: BusRoute = {
      id: `MTRT-${heart.mtrt.line}-${heart.mtrt.sta}`,
      route: heart.route,
      operator: "MTRT",
      originTc: "",
      originEn: "",
      destTc: heart.destTc,
      destEn: heart.destEn,
      mtrt: heart.mtrt,
    };
    return <MTRTStationETAs route={route} />;
  }

  return (
    <div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <OperatorBadge operator={heart.operator} />
            <span className="font-bold text-slate-900 text-[19px]">{heart.route}</span>
            <span className="text-rose-500 text-[17px]">❤</span>
          </div>
          <div className="text-[15px] text-slate-500 truncate mt-0.5">
            {heart.originTc} → {heart.destTc}
          </div>
        </div>
      </div>
      <div className="mt-3 bg-white rounded-2xl border-2 border-rose-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="bg-rose-500 text-white text-[14px] font-bold px-2 py-0.5 rounded-full">
            第 {heart.stopSeq} 站
          </span>
          <span className="text-[14px] text-slate-400">我的心水站</span>
        </div>
        <div className="text-[18px] font-bold text-slate-900">{heart.stopNameTc}</div>
        {heart.stopNameEn && (
          <div className="text-[15px] text-slate-500 mt-0.5">{heart.stopNameEn}</div>
        )}
        <div className="mt-3 pt-3 border-t border-slate-100">
          {isLoading ? (
            <div className="text-[17px] text-slate-400 py-2">載入班次中…</div>
          ) : !etas || etas.length === 0 ? (
            <div className="text-[17px] text-slate-500 py-2">暫無班次</div>
          ) : (
            <div className="space-y-2">
              {etas.slice(0, 3).map((e, i) => {
                const urgent = e.etaMinutes !== null && e.etaMinutes <= 3 && e.etaMinutes >= 0;
                return (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-[17px] text-slate-600">往 {e.destTc || e.destEn}</span>
                    <span className={clsx(
                      "text-[19px] font-bold tabular-nums",
                      e.etaMinutes !== null && e.etaMinutes <= 1 ? "text-emerald-600"
                      : e.etaMinutes !== null && e.etaMinutes <= 5 ? "text-amber-600" : "text-slate-700",
                      urgent && "eta-urgent"
                    )}>
                      {e.etaMinutes === null ? (e.remarkTc || "—")
                        : e.etaMinutes <= 0
                          ? "即將到站"
                          : (() => {
                              const arrival = new Date(Date.now() + e.etaMinutes! * 60000);
                              const hh = String(arrival.getHours()).padStart(2, "0");
                              const mm = String(arrival.getMinutes()).padStart(2, "0");
                              return `${e.etaMinutes} 分鐘 (${hh}:${mm})`;
                            })()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
