/**
 * Calculate distance between two lat/lng points in meters using Haversine formula.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Merge stops from KMB and CTB that are within threshold meters and have similar names.
 * Returns unified BusStop[] with originalIds.
 */
export function mergeStops(
  kmbStops: { id: string; nameEn: string; nameTc: string; lat: number; lng: number }[],
  ctbStops: { id: string; nameEn: string; nameTc: string; lat: number; lng: number }[],
  thresholdMeters = 30
): import("@/types/bus").BusStop[] {
  const merged: import("@/types/bus").BusStop[] = [];
  const usedCtb = new Set<string>();

  for (const k of kmbStops) {
    let match: typeof ctbStops[0] | null = null;
    let minDist = Infinity;

    for (const c of ctbStops) {
      if (usedCtb.has(c.id)) continue;
      const dist = haversineDistance(k.lat, k.lng, c.lat, c.lng);
      if (dist < thresholdMeters && dist < minDist) {
        // Simple name similarity: shared words or substring
        const kWords = k.nameEn.toLowerCase().split(/[\s,]+/);
        const cWords = c.nameEn.toLowerCase().split(/[\s,]+/);
        const shared = kWords.filter((w) => cWords.includes(w) && w.length > 2);
        if (shared.length > 0 || k.nameEn.toLowerCase().includes(c.nameEn.toLowerCase().slice(0, 8))) {
          match = c;
          minDist = dist;
        }
      }
    }

    if (match) {
      usedCtb.add(match.id);
      merged.push({
        id: `merged-${k.id}-${match.id}`,
        originalIds: [
          { operator: "KMB", id: k.id },
          { operator: "CTB", id: match.id },
        ],
        nameEn: k.nameEn || match.nameEn,
        nameTc: k.nameTc || match.nameTc,
        lat: (k.lat + match.lat) / 2,
        lng: (k.lng + match.lng) / 2,
        isMerged: true,
      });
    } else {
      merged.push({
        id: `kmb-${k.id}`,
        originalIds: [{ operator: "KMB", id: k.id }],
        nameEn: k.nameEn,
        nameTc: k.nameTc,
        lat: k.lat,
        lng: k.lng,
      });
    }
  }

  // Remaining CTB
  for (const c of ctbStops) {
    if (!usedCtb.has(c.id)) {
      merged.push({
        id: `ctb-${c.id}`,
        originalIds: [{ operator: "CTB", id: c.id }],
        nameEn: c.nameEn,
        nameTc: c.nameTc,
        lat: c.lat,
        lng: c.lng,
      });
    }
  }

  return merged;
}

/**
 * Filter stops within a bounding box (with optional padding).
 */
export function filterStopsInBounds(
  stops: import("@/types/bus").BusStop[],
  bounds: { north: number; south: number; east: number; west: number },
  padding = 0.002
): import("@/types/bus").BusStop[] {
  return stops.filter(
    (s) =>
      s.lat <= bounds.north + padding &&
      s.lat >= bounds.south - padding &&
      s.lng <= bounds.east + padding &&
      s.lng >= bounds.west - padding
  );
}

/**
 * Find closest N stops to a point.
 */
export function findClosestStops(
  stops: import("@/types/bus").BusStop[],
  lat: number,
  lng: number,
  n = 15
): import("@/types/bus").BusStop[] {
  return [...stops]
    .map((s) => ({
      stop: s,
      dist: haversineDistance(lat, lng, s.lat, s.lng),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map((x) => x.stop);
}

export const DEFAULT_HK_CENTER = { lat: 22.3193, lng: 114.1694 }; // Central-ish
export const DEFAULT_ZOOM = 14;