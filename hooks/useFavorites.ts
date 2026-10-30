"use client";

import { useState, useEffect, useCallback } from "react";
import type { FavoriteStop, BusStop } from "@/types/bus";

const STORAGE_KEY = "hk-bus-eta-favorites";

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteStop[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setFavorites(JSON.parse(raw));
      }
    } catch (e) {
      console.warn("Failed to load favorites", e);
    }
    setLoaded(true);
  }, []);

  const persist = useCallback((list: FavoriteStop[]) => {
    setFavorites(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Failed to save favorites", e);
    }
  }, []);

  const addFavorite = useCallback(
    (stop: BusStop) => {
      setFavorites((prev) => {
        if (prev.some((f) => f.id === stop.id)) return prev;
        const next: FavoriteStop[] = [
          ...prev,
          {
            id: stop.id,
            nameEn: stop.nameEn,
            nameTc: stop.nameTc,
            lat: stop.lat,
            lng: stop.lng,
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

  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.filter((f) => f.id !== id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (id: string) => favorites.some((f) => f.id === id),
    [favorites]
  );

  const toggleFavorite = useCallback(
    (stop: BusStop) => {
      if (isFavorite(stop.id)) {
        removeFavorite(stop.id);
      } else {
        addFavorite(stop);
      }
    },
    [isFavorite, addFavorite, removeFavorite]
  );

  return {
    favorites,
    loaded,
    addFavorite,
    removeFavorite,
    isFavorite,
    toggleFavorite,
  };
}