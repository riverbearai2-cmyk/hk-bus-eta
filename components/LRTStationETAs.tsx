"use client";

import useSWR from "swr";
import type { BusRoute } from "@/types/bus";
import { useFavoriteHearts } from "@/hooks/useFavoriteHearts";
import { clsx } from "clsx";

/**
 * Light Rail station ETA view.
 * Shows next trains for a Light Rail stop.
 */
export function LRTStationETAs({ route }: { route: BusRoute }) {
  // Primary: route.lrt; Fallback: parse from route.id (LRT-{stationId} or LRT-R-{route})
  let lrt = route.lrt;
  if (!lrt && route.id.startsWith("LRT-")) {
    const stationId = route.id.replace("LRT-", "").replace("R-", "");
    lrt = {
      stationId,
      tc: route.originTc || route.route.replace("站", "").replace("輕鐵 ", "").replace("號", ""),
      en: route.originEn || "",
    };
  }
  const { data: etas, isLoading } = useSWR(
    lrt ? ["lrt-etas-direct", lrt.stationId] : null,
    async () => {
      try {
        const res = await fetch(
          `https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule?station_id=${lrt!.stationId}`
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
                id: `lrt-${lrt!.stationId}-${plat.platform_id}-${r.route_no}`,
                operator: "LRT" as const,
                route: `${r.route_no}號`,
                destEn: r.dest_en || "",
                destTc: r.dest_ch || "",
                eta: null,
                etaMinutes: mins,
                remarkEn: r.time_en || undefined,
                remarkTc: r.time_ch || undefined,
                platform: plat.platform_id ? String(plat.platform_id) : undefined,
                sequence: trains.length + 1,
                isRealtime: true,
              });
            }
          }
          // 2026-10-29: sort by time like the nearby card (v1.1.22) - the
          // detail view previously showed raw platform order, so the
          // earliest train was not on top.
          trains.sort((a, b) => (a.etaMinutes ?? 9999) - (b.etaMinutes ?? 9999));
          return trains;
        }
      } catch (e) {
        console.error("LRTStationETAs fetch failed:", e);
      }
      return [];
    },
    {
      refreshInterval: 10000,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const { isHeart, toggleHeart } = useFavoriteHearts();
  const hearted = lrt ? isHeart(route, 1) : false;

  if (!lrt) return null;

  return (
    <div className="space-y-3">
      <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="text-[14px] text-orange-700 font-medium mb-1">
            輕鐵 · Light Rail
          </div>
          <button
            onClick={() =>
              toggleHeart({
                route,
                stopSeq: 1,
                stopNameTc: `${lrt.tc}站`,
                stopNameEn: `${lrt.en} Stop`,
              })
            }
            className="text-[22px] active:scale-110 transition"
            aria-label={hearted ? "取消心水站" : "加入心水站"}
          >
            {hearted ? "❤️" : "♡"}
          </button>
        </div>
        <div className="text-[19px] font-bold text-slate-900">
          {lrt.tc}站
        </div>
        <div className="text-[14px] text-slate-500">{lrt.en} Stop</div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-slate-400 text-[15px]">
          載入班次中…
        </div>
      ) : !etas || etas.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 text-center text-[15px] text-slate-500">
          暫無班次（可能已收車）
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3">
          {etas.map((e, i) => {
            const urgent = e.etaMinutes !== null && e.etaMinutes <= 3 && e.etaMinutes >= 0;
            return (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[17px] font-bold text-slate-900">{e.route}</div>
                  <div className="text-[13px] text-slate-500 truncate">
                    往 {e.destTc || e.destEn}
                    {e.platform ? ` · ${e.platform}號月台` : ""}
                  </div>
                </div>
                <span
                  className={clsx(
                    "text-[17px] font-bold tabular-nums shrink-0 ml-3",
                    e.etaMinutes !== null && e.etaMinutes <= 1
                      ? "text-emerald-600"
                      : e.etaMinutes !== null && e.etaMinutes <= 5
                        ? "text-amber-600"
                        : "text-slate-700",
                    urgent && "eta-urgent"
                  )}
                >
                  {e.etaMinutes === null
                    ? (e.remarkTc && e.remarkTc !== "-"
                        ? e.remarkTc
                        : e.remarkEn && e.remarkEn !== "-"
                          ? e.remarkEn
                          : "時間待定")
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

      <div className="text-[12px] text-slate-400 text-center">
        資料每 10 秒更新 · 輕鐵實時班次
      </div>
    </div>
  );
}
