"use client";

import { useState, useEffect } from "react";

// Cache for station code -> {tc, en} mapping
let codeMap: Map<string, { tc: string; en: string }> | null = null;

async function loadCodeMap(): Promise<Map<string, { tc: string; en: string }>> {
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
  } catch {
    // ignore
  }
  return codeMap;
}

export function useMTRStationName(code: string): { tc: string; en: string } | null {
  const [name, setName] = useState<{ tc: string; en: string } | null>(null);

  useEffect(() => {
    loadCodeMap().then((map) => {
      setName(map.get(code) || null);
    });
  }, [code]);

  return name;
}

// Synchronous version for use in already-loaded contexts
export async function getMTRStationName(code: string): Promise<{ tc: string; en: string } | null> {
  const map = await loadCodeMap();
  return map.get(code) || null;
}
