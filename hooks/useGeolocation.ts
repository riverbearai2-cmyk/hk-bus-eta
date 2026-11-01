"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface GeoState {
  lat: number;
  lng: number;
  accuracy?: number;
  loading: boolean;
  error: string | null;
  permission: "prompt" | "granted" | "denied" | "unknown";
}

// CNE 內嵌專用橋接：iOS Safari 唔會為跨域 iframe 彈定位授權，
// 框入面直接叫 geolocation 會靜默失敗／hang 住。所以嵌入時唔直接攞位置，
// 改叫頂層（CNE，rb-1997.github.io）攞位置再用 postMessage 傳入框。
const PARENT_ORIGIN = "https://rb-1997.github.io";

function isEmbedded() {
  return typeof window !== "undefined" && window.self !== window.top;
}

export function useGeolocation(autoRequest = true) {
  const [state, setState] = useState<GeoState>({
    lat: 0,
    lng: 0,
    loading: autoRequest,
    error: null,
    permission: "unknown",
  });
  const pendingRef = useRef<number | null>(null);

  const setManualLocation = useCallback(
    (lat: number, lng: number, accuracy?: number) => {
      if (pendingRef.current) {
        window.clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
      setState({
        lat,
        lng,
        accuracy,
        loading: false,
        error: null,
        permission: "granted",
      });
    },
    []
  );

  const setLocationError = useCallback((msg: string, denied: boolean) => {
    if (pendingRef.current) {
      window.clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
    setState((s) => ({
      ...s,
      loading: false,
      error: msg,
      permission: denied ? "denied" : "unknown",
    }));
  }, []);

  // 接收頂層傳入嘅位置（嵌入模式）；載好即刻話俾頂層知，等頂層有已攞到嘅位置就即刻傳返入嚟。
  useEffect(() => {
    if (!isEmbedded()) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== PARENT_ORIGIN) return;
      const d = e.data as {
        type?: string;
        lat?: number;
        lng?: number;
        accuracy?: number;
      };
      if (!d || typeof d.type !== "string") return;
      if (
        d.type === "cne-set-location" &&
        typeof d.lat === "number" &&
        typeof d.lng === "number"
      ) {
        setManualLocation(d.lat, d.lng, d.accuracy);
      } else if (d.type === "cne-location-error") {
        setLocationError("未能取得位置，請檢查定位授權", true);
      }
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "cne-eta-ready" }, PARENT_ORIGIN);
    return () => window.removeEventListener("message", onMessage);
  }, [setManualLocation, setLocationError]);

  const requestLocation = useCallback(() => {
    // 嵌入模式：叫頂層攞位置（頂層先會彈授權提示）；25 秒內冇回覆就當失敗，唔好 hang 住個掣。
    if (isEmbedded()) {
      setState((s) => ({ ...s, loading: true, error: null }));
      window.parent.postMessage({ type: "cne-request-location" }, PARENT_ORIGIN);
      if (pendingRef.current) window.clearTimeout(pendingRef.current);
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null;
        setState((s) =>
          s.loading
            ? { ...s, loading: false, error: "未能取得位置，請再試一次" }
            : s
        );
      }, 25000);
      return;
    }

    if (!navigator.geolocation) {
      setState((s) => ({
        ...s,
        loading: false,
        error: "呢個瀏覽器唔支援定位",
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
        let msg = "未能取得位置";
        if (err.code === 1) msg = "未能取得位置授權，請允許定位後再試";
        else if (err.code === 2) msg = "未能取得位置，請檢查定位服務";
        else if (err.code === 3) msg = "定位逾時，請去空曠位置再試";
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
