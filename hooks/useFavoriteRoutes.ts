"use client";

import { useState, useEffect, useCallback } from "react";
import type { FavoriteRoute, BusRoute } from "@/types/bus";

const STORAGE_KEY = "hk-bus-eta-fav-routes";

export function useFavoriteRoutes() {
  const [favRoutes, setFavRoutes] = useState<FavoriteRoute[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setFavRoutes(JSON.parse(raw));
      }
    } catch (e) {
      console.warn("Failed to load fav routes", e);
    }
    setLoaded(true);
  }, []);

  const persist = useCallback((list: FavoriteRoute[]) => {
    setFavRoutes(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }, []);

  const isFavRoute = useCallback(
    (id: string) => favRoutes.some((f) => f.id === id),
    [favRoutes]
  );

  const toggleFavRoute = useCallback(
    (route: BusRoute) => {
      setFavRoutes((prev) => {
        const exists = prev.some((f) => f.id === route.id);
        const next: FavoriteRoute[] = exists
          ? prev.filter((f) => f.id !== route.id)
          : [
              ...prev,
              {
                id: route.id,
                route: route.route,
                operator: route.operator,
                originTc: route.originTc || "",
                originEn: route.originEn || "",
                destTc: route.destTc || "",
                destEn: route.destEn || "",
                directionLabel: route.directionLabel,
                bound: route.bound,
                gmb: route.gmb,
                nlb: route.nlb,
                ferry: route.ferry,
                savedAt: Date.now(),
              },
            ];
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    []
  );

  const removeFavRoute = useCallback(
    (id: string) => {
      persist(favRoutes.filter((f) => f.id !== id));
    },
    [favRoutes, persist]
  );

  return { favRoutes, loaded, isFavRoute, toggleFavRoute, removeFavRoute };
}
