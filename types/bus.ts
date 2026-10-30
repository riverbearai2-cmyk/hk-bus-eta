export type Operator = "KMB" | "CTB" | "LWB" | "GMB" | "MTR" | "MTRT" | "LRT" | "NLB" | "SUNFERRY" | "HKKF" | "STARFERRY";

export interface BusStop {
  id: string; // unified or original
  originalIds: { operator: Operator; id: string }[];
  nameEn: string;
  nameTc: string;
  nameSc?: string;
  lat: number;
  lng: number;
  // For merged
  isMerged?: boolean;
  // For green minibus stops picked from a route path
  gmb?: {
    route_id: number;
    route_seq: number;
    stop_seq: number;
    code: string;
    dest_tc: string;
    dest_en: string;
  };
}


export interface FerryMeta {
  company: "SUN" | "HKKF" | "STAR";
  code: string; // SUN: route code (CECC); HKKF: route id ("2"); STAR: direction code (CT)
  dir?: string; // HKKF: "outbound" | "inbound"
  starDir?: string; // STAR: timetable direction string
  fromPier: string;
  toPier: string;
}

export interface BusRoute {
  id: string; // e.g. "KMB-101-1" or "CTB-107" or "GMB-HKI-1-1"
  operator: Operator;
  route: string;
  serviceType?: string; // KMB only, "1" usually
  bound?: "I" | "O" | "inbound" | "outbound"; // direction
  originEn: string;
  originTc: string;
  destEn: string;
  destTc: string;
  // For display
  directionLabel?: string;
  // For green minibus (bundled static data)
  gmb?: {
    region: string;
    code: string;
    route_id: number;
    route_seq: number;
  };
  // For MTR trains (heavy rail)
  mtrt?: {
    line: string;
    lineTc: string;
    lineEn: string;
    sta?: string;
    staTc?: string;
    staEn?: string;
  };
  // For Light Rail
  lrt?: {
    stationId: string;
    tc: string;
    en: string;
  };
  // For Light Rail route search results (e.g. "505"), the route number
  lrtRoute?: string;
  // For New Lantao Bus (NLB): API routeId (one per direction)
  nlb?: {
    routeId: number;
  };
  // For ferries (Sun Ferry / HKKF / Star Ferry)
  ferry?: FerryMeta;
}

// A stop in a route's stop sequence. KMB/CTB resolve coords via the global
// stop list; GMB carries its own coords + names from the bundled dataset.
export interface RouteStopSeq {
  stop: string;
  seq: number;
  lat?: number;
  lng?: number;
  name_tc?: string;
  name_en?: string;
}

// Clickable stop marker on a drawn route path (used for GMB, whose stops
// are not in the global stop list).
export interface PathStopMarker {
  lat: number;
  lng: number;
  seq: number;
  name_tc?: string;
  name_en?: string;
  gmb?: {
    route_id: number;
    route_seq: number;
    stop_seq: number;
    code: string;
    dest_tc: string;
    dest_en: string;
  };
}

export interface ETA {
  id: string;
  operator: Operator;
  route: string;
  destEn: string;
  destTc: string;
  eta: string | null; // ISO or null if unknown
  etaMinutes: number | null;
  remarkEn?: string;
  remarkTc?: string;
  platform?: string; // rail platform number from the operator API (MTR plat / LRT platform_id)
  sequence: number;
  isRealtime: boolean;
}

export interface StopWithRoutes {
  stop: BusStop;
  routes: BusRoute[];
  etas: ETA[];
}

export interface FavoriteStop {
  id: string;
  nameEn: string;
  nameTc: string;
  lat: number;
  lng: number;
  savedAt: number;
}

export interface FavoriteRoute {
  id: string;
  route: string;
  operator: Operator;
  originTc: string;
  originEn: string;
  destTc: string;
  destEn: string;
  directionLabel?: string;
  bound?: "I" | "O" | "inbound" | "outbound";
  gmb?: {
    region: string;
    code: string;
    route_id: number;
    route_seq: number;
  };
  nlb?: {
    routeId: number;
  };
  ferry?: FerryMeta;
  savedAt: number;
}

// Heart favorite: a specific stop on a specific route+direction.
// e.g. "44B1 往皇崗口岸 @ 翠寧站" — for the user's regular boarding stop.
export interface FavoriteRouteStop {
  id: string; // e.g. "hrt-GMB-NT-44B1-1-5"
  routeId: string; // original BusRoute.id, for re-selecting the route
  route: string;
  operator: Operator;
  directionLabel?: string;
  bound?: "I" | "O" | "inbound" | "outbound";
  originTc: string;
  originEn: string;
  destTc: string;
  destEn: string;
  stopSeq: number;
  stopNameTc: string;
  stopNameEn: string;
  gmb?: {
    region: string;
    code: string;
    route_id: number;
    route_seq: number;
  };
  lrt?: {
    stationId: string;
    tc: string;
    en: string;
  };
  mtrt?: {
    line: string;
    sta: string;
    lineTc: string;
    lineEn: string;
  };
  nlb?: {
    routeId: number;
  };
  ferry?: FerryMeta;
  savedAt: number;
}

// Raw API types (partial)
export interface KMBStopRaw {
  stop: string;
  name_en: string;
  name_tc: string;
  name_sc: string;
  lat: string;
  long: string;
}

export interface KMBRouteRaw {
  route: string;
  bound: string; // "I" | "O"
  service_type: string;
  orig_en: string;
  orig_tc: string;
  dest_en: string;
  dest_tc: string;
}

export interface KMBETARaw {
  co: string;
  route: string;
  dir: string;
  service_type: number;
  seq: number;
  dest_tc: string;
  dest_en: string;
  eta_seq: number;
  eta: string | null;
  rmk_tc: string;
  rmk_en: string;
  data_timestamp: string;
}

export interface CTBStopRaw {
  stop: string;
  name_en: string;
  name_tc: string;
  name_sc: string;
  lat: number;
  long: number;
}

export interface CTBRouteRaw {
  co: string;
  route: string;
  orig_en: string;
  orig_tc: string;
  dest_en: string;
  dest_tc: string;
}

export interface CTBETARaw {
  co: string;
  route: string;
  dir: string;
  seq: number;
  stop: string;
  dest_tc: string;
  dest_en: string;
  eta_seq: number;
  eta: string | null;
  rmk_tc: string;
  rmk_en: string;
  data_timestamp: string;
}