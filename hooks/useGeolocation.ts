"use client";

import { useState, useEffect, useCallback } from "react";

interface GeoState {
  lat: number;
  lng: number;
  accuracy?: number;
  loading: boolean;
  error: string | null;
  permission: "prompt" | "granted" | "denied" | "unknown";
}

export function useGeolocation(autoRequest = true) {
  const [state, setState] = useState<GeoState>({
    lat: 0,
    lng: 0,
    loading: autoRequest,
    error: null,
    permission: "unknown",
  });

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({
        ...s,
        loading: false,
        error: "Geolocation not supported by this browser",
        permission: "denied",
      }));
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          loading: false,
          error: null,
          permission: "granted",
        });
      },
      (err) => {
        let msg = "Unable to retrieve location";
        if (err.code === 1) msg = "Location permission denied";
        else if (err.code === 2) msg = "Location unavailable";
        else if (err.code === 3) msg = "Location request timed out";
        setState((s) => ({
          ...s,
          loading: false,
          error: msg,
          permission: err.code === 1 ? "denied" : "unknown",
        }));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }, []);

  useEffect(() => {
    if (autoRequest) {
      requestLocation();
    }
  }, [autoRequest, requestLocation]);

  return { ...state, requestLocation };
}