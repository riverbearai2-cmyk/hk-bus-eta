"use client";

import useSWR from "swr";
import type { BusStop, ETA, BusRoute, RouteStopSeq } from "@/types/bus";
import {
  getStops,
  getETAs,
  getAllETAsForStop,
  searchRoutes,
  getRouteStops,
} from "@/utils/static-api";

export function useStops() {
  const { data, error, isLoading, mutate } = useSWR<BusStop[]>(
    "stops",
    () => getStops(),
    {
      revalidateOnFocus: false,
      revalidateIfStale: true,
      dedupingInterval: 3600000, // 1h
      errorRetryCount: 2,
    }
  );

  return {
    stops: data || [],
    isLoading,
    error: error?.message || null,
    refresh: mutate,
  };
}

export function useETA(
  stop: BusStop | null,
  enabled = true
) {
  // Use getAllETAsForStop which queries all linked operators (KMB+CTB+MTR+GMB)
  let key: [string, string] | null = null;
  if (stop && enabled) {
    key = ["eta-all", stop.id];
  }

  const { data, error, isLoading, isValidating, mutate } = useSWR<ETA[]>(
    key,
    () => getAllETAsForStop(stop!),
    {
      refreshInterval: 10000, // auto-refresh every 10s
      revalidateOnFocus: false, // avoid request storm on focus
      dedupingInterval: 5000,
      errorRetryCount: 2,
    }
  );

  return {
    etas: data || [],
    isLoading,
    isValidating,
    error: error?.message || null,
    refresh: mutate,
    timestamp: undefined as string | undefined,
  };
}

export function useRouteSearch(query: string) {
  const q = query.trim();
  const key = q.length >= 1 ? (["routes", q] as [string, string]) : null;

  const { data, error, isLoading } = useSWR<BusRoute[]>(key, (k: [string, string]) => searchRoutes(k[1]), {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });

  return {
    routes: data || [],
    isLoading,
    error: error?.message || null,
  };
}

export function useRouteStops(
  route: string | null,
  operator: "KMB" | "CTB" | "LWB" | "GMB" | "MTR" | "NLB" | "SUNFERRY" | "HKKF" | "STARFERRY" | null,
  bound: string = "O",
  gmbMeta?: { region: string; code: string; route_id: number; route_seq: number },
  nlbMeta?: { routeId: number },
  ferryMeta?: import("@/types/bus").FerryMeta
) {
  const key =
    route && operator
      ? (["route-stops", route, operator, bound, gmbMeta?.route_seq ?? nlbMeta?.routeId ?? ferryMeta?.code ?? 0] as [string, string, string, string, number | string])
      : null;

  const { data, error, isLoading } = useSWR<RouteStopSeq[]>(key, (k: [string, string, string, string, number | string]) =>
    getRouteStops(k[1], k[2] as "KMB" | "CTB" | "LWB" | "GMB" | "MTR" | "NLB" | "SUNFERRY" | "HKKF" | "STARFERRY", k[3], gmbMeta, nlbMeta, ferryMeta), {
    revalidateOnFocus: false,
    dedupingInterval: 300000,
  });

  return {
    stopSeqs: (data || []) as RouteStopSeq[],
    isLoading,
    error: error?.message || null,
  };
}
