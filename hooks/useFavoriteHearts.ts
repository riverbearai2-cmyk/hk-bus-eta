"use client";

import { useState, useEffect, useCallback } from "react";
import type { FavoriteRouteStop, BusRoute } from "@/types/bus";

const STORAGE_KEY = "hk-bus-eta-fav-hearts";

export interface HeartInput {
  route: BusRoute;
  stopSeq: number;
  stopNameTc: string;
  stopNameEn: string;
}

function heartId(route: BusRoute, stopSeq: number): string {
  return `hrt-${route.operator}-${route.id}-${stopSeq}`;
}

export function useFavoriteHearts() {
  const [hearts, setHearts] = useState<FavoriteRouteStop[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setHearts(JSON.parse(raw));
      }
    } catch (e) {
      console.warn("Failed to load fav hearts", e);
    }
    setLoaded(true);
  }, []);

  const persist = useCallback((list: FavoriteRouteStop[]) => {
    setHearts(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }, []);

  const isHeart = useCallback(
    (route: BusRoute, stopSeq: number) =>
      hearts.some((h) => h.id === heartId(route, stopSeq)),
    [hearts]
  );

  const toggleHeart = useCallback((input: HeartInput) => {
    const { route, stopSeq, stopNameTc, stopNameEn } = input;
    const id = heartId(route, stopSeq);
    // Read latest from localStorage (not stale state) to avoid overwriting
    // hearts added from other components
    let current: FavoriteRouteStop[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) current = JSON.parse(raw);
    } catch {}
    const exists = current.some((h) => h.id === id);
    const next: FavoriteRouteStop[] = exists
      ? current.filter((h) => h.id !== id)
      : [
          ...current,
          {
            id,
            routeId: route.id,
            route: route.route,
            operator: route.operator,
            directionLabel: route.directionLabel,
            bound: route.bound,
            originTc: route.originTc || "",
            originEn: route.originEn || "",
            destTc: route.destTc || "",
            destEn: route.destEn || "",
            stopSeq,
            stopNameTc: stopNameTc || "",
            stopNameEn: stopNameEn || "",
            gmb: (route as any).gmb,
            lrt: (route as any).lrt,
            mtrt: (route as any).mtrt,
            nlb: (route as any).nlb,
            ferry: (route as any).ferry,
            savedAt: Date.now(),
          } as FavoriteRouteStop,
        ];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    setHearts(next);
  }, []);

  const removeHeart = useCallback((id: string) => {
    let current: FavoriteRouteStop[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) current = JSON.parse(raw);
    } catch {}
    const next = current.filter((h) => h.id !== id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    setHearts(next);
  }, []);

  const moveHeart = useCallback((id: string, direction: "up" | "down") => {
    let current: FavoriteRouteStop[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) current = JSON.parse(raw);
    } catch {}
    const idx = current.findIndex((h) => h.id === id);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= current.length) return;
    const next = [...current];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    setHearts(next);
  }, []);

  return { hearts, loaded, isHeart, toggleHeart, removeHeart, moveHeart };
}
