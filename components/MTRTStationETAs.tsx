"use client";

import useSWR from "swr";
import type { BusRoute, ETA } from "@/types/bus";
import { clsx } from "clsx";
import { useState, useEffect } from "react";
import { useFavoriteHearts } from "@/hooks/useFavoriteHearts";

// Station code -> name mapping (loaded from bundled data)
let codeMap: Map<string, { tc: string; en: string }> | null = null;
async function getCodeMap() {
  if (codeMap) return codeMap;
  codeMap = new Map();
  try {
    const res = await fetch("mtr/train-stations.json");
    const data = await res.json();
    for (const stations of Object.values(data.lines) as any[][]) {
      if (!Array.isArray(stations)) continue;
      for (const s of stations) {
        if (s.code && !codeMap.has(s.code)) {
          codeMap.set(s.code, { tc: s.tc, en: s.en });
        }
      }
    }
  } catch {}
  return codeMap;
}

function MTRTDest({ code }: { code: string }) {
  const [name, setName] = useState<string>(code);
  useEffect(() => {
    getCodeMap().then((map) => {
      const n = map.get(code);
      if (n) setName(n.tc);
    });
  }, [code]);
  return <>{name}</>;
}

/**
 * MTR Train station ETA view.
 * Shows next trains for a station (UP/DOWN directions).
 * Uses the MTR proxy (official API has no CORS).
 */
export function MTRTStationETAs({ route }: { route: BusRoute }) {
  // Primary: route.mtrt; Fallback: parse from route.id (MTRT-{line}-{sta})
  let mtrt = route.mtrt;
  if (!mtrt && route.id.startsWith("MTRT-")) {
    const parts = route.id.split("-");
    if (parts.length >= 3) {
      mtrt = {
        line: parts[1],
        sta: parts[2],
        lineTc: route.destTc || parts[1],
        lineEn: route.destEn || parts[1],
        staTc: "",
        staEn: "",
      };
    }
  }
  const { data: etas, isLoading } = useSWR(
    mtrt ? ["mtrt-etas-direct", mtrt.line, mtrt.sta] : null,
    async () => {
      try {
        // Ensure station code map is loaded for dest names
        await getCodeMap();
        const res = await fetch(
          `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${mtrt!.line}&sta=${mtrt!.sta}&lang=TC`
        ).then((r) => r.json());
        const trains: any[] = [];
        const key = `${mtrt!.line}-${mtrt!.sta}`;
        const data = res.data?.[key];
        if (data) {
          for (const dir of ["UP", "DOWN"]) {
            const list = data[dir] || [];
            for (const t of list) {
              // t.time is like "12:07" or "4 分鐘", t.dest is destination
              let mins: number | null = null;
              const timeStr = t.time || "";
              const m = timeStr.match(/(\d+)\s*分/);
              if (m) {
                mins = parseInt(m[1], 10);
              } else if (timeStr.includes("-") && timeStr.includes(":")) {
                // "2026-10-19 12:18:07" format - parse as datetime
                const arr = new Date(timeStr.replace(" ", "T"));
                if (!isNaN(arr.getTime())) {
                  const now = new Date();
                  mins = Math.round((arr.getTime() - now.getTime()) / 60000);
                  if (mins < 0) mins = 0;
                }
              } else if (timeStr.includes(":")) {
                // "12:07" format - calculate diff from now
                const parts = timeStr.split(":");
                const hh = parseInt(parts[parts.length - 2], 10);
                const mm = parseInt(parts[parts.length - 1], 10);
                if (!isNaN(hh) && !isNaN(mm)) {
                  const now = new Date();
                  const arr = new Date();
                  arr.setHours(hh, mm, 0, 0);
                  mins = Math.round((arr.getTime() - now.getTime()) / 60000);
                  if (mins < 0) mins = 0;
                }
              }
              // Map dest station code to Chinese name
              const destInfo = codeMap?.get(t.dest);
              const destTc = destInfo?.tc || t.dest || "";
              const destEn = destInfo?.en || t.dest || "";
              trains.push({
                id: `mtrt-${mtrt!.sta}-${dir}-${t.seq}`,
                operator: "MTRT" as const,
                route: mtrt!.lineTc,
                destTc,
                destEn,
                etaMinutes: mins,
                remarkTc: timeStr,
                platform: (t as any).plat ? String((t as any).plat) : undefined,
                sequence: trains.length + 1,
                isRealtime: true,
              });
            }
          }
        }
        return trains;
      } catch (e) {
        console.error("MTRTStationETAs fetch failed:", e);
        return [];
      }
    },
    {
      refreshInterval: 10000,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const { isHeart, toggleHeart } = useFavoriteHearts();
  const hearted = mtrt ? isHeart(route, 1) : false;

  if (!mtrt) return null;

  // Group by direction (UP/DOWN) - we use dest to distinguish
  // Actually the API returns UP/DOWN arrays; we flatten them in getETAs
  // For display, group by destTc
  const byDest = new Map<string, typeof etas>();
  for (const e of etas || []) {
    const key = e.destTc || e.destEn;
    if (!byDest.has(key)) byDest.set(key, []);
    byDest.get(key)!.push(e);
  }

  return (
    <div className="space-y-3">
      <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="text-[14px] text-purple-700 font-medium mb-1">
            {mtrt.lineTc} · {mtrt.lineEn}
          </div>
          <button
            onClick={() =>
              toggleHeart({
                route,
                stopSeq: 1,
                stopNameTc: `${mtrt.staTc}站`,
                stopNameEn: `${mtrt.staEn} Station`,
              })
            }
            className="text-[22px] active:scale-110 transition"
            aria-label={hearted ? "取消心水站" : "加入心水站"}
          >
            {hearted ? "❤️" : "♡"}
          </button>
        </div>
        <div className="text-[19px] font-bold text-slate-900">
          {mtrt.staTc}站
        </div>
        <div className="text-[14px] text-slate-500">{mtrt.staEn} Station</div>
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
        Array.from(byDest.entries()).map(([dest, list]) => (
          <div key={dest} className="bg-white rounded-2xl border border-slate-100 p-4">
            <div className="text-[15px] font-semibold text-slate-900 mb-3">
              往 <MTRTDest code={dest} />
            </div>
            <div className="space-y-2">
              {list!.map((e, i) => {
                const urgent = e.etaMinutes !== null && e.etaMinutes <= 3 && e.etaMinutes >= 0;
                return (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-[14px] text-slate-500">
                      {e.remarkTc || e.remarkEn || `第 ${i + 1} 班`}
                      {e.platform ? ` · ${e.platform}號月台` : ""}
                    </span>
                    <span
                      className={clsx(
                        "text-[17px] font-bold tabular-nums",
                        e.etaMinutes !== null && e.etaMinutes <= 1
                          ? "text-emerald-600"
                          : e.etaMinutes !== null && e.etaMinutes <= 5
                            ? "text-amber-600"
                            : "text-slate-700",
                        urgent && "eta-urgent"
                      )}
                    >
                      {e.etaMinutes === null
                        ? "—"
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
          </div>
        ))
      )}

      <div className="text-[12px] text-slate-400 text-center">
        資料每 30 秒更新 · 港鐵實時班次
      </div>
    </div>
  );
}
