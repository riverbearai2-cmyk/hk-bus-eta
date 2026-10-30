# Bus ETA App — Data Integrity Audit Report

**Date:** 2026-10-19
**Auditor:** Muse (subagent)
**Scope:** All bundled static data files + live API spot checks
**Context:** Pre-publish data quality review requested by RB3 after 68X display concerns

---

## Executive Summary

| Data file | Records | Duplicates | Empty IDs | Status |
|---|---|---|---|---|
| `kmb-routes.json` | 1,611 routes | 0 | 0 | ✅ CLEAN |
| `stops.json` | 6,775 stops | 0 | 0 | ✅ CLEAN |
| `gmb/index.json` | 912 route-directions | 0 true dups | 0 | ✅ CLEAN |
| `gmb/routes/*.json` | 573 files / 912 directions | 0 dup seq | 0 empty stop_id | ✅ CLEAN |
| `mtr/routes/*.json` | 41 files | **8 files with dup seq** | 0 | ⚠️ **ISSUES FOUND** |
| `mtr/train-stations.json` | 121 stations | 0 | 0 | ✅ CLEAN |
| `mtr/light-rail.json` | 68 stops | 0 | 0 | ✅ CLEAN |
| `ctb/stop-routes.json` | 2,594 stops | n/a (lookup) | n/a | ✅ CLEAN |
| `ctb/oneway.json` | — | — | — | ✅ CLEAN |

**Verdict: NOT YET SAFE to publish — 8 MTR Bus route files have corrupted stop sequences (duplicate seq numbers) that will display duplicate station numbers in the app.**

---

## 1. KMB Data ✅ CLEAN

**`public/kmb-routes.json`** (1,611 entries)
- Checked: duplicate (route, bound, service_type) combinations → **0 duplicates**
- All entries have route/bound/orig/dest fields populated

**`public/stops.json`** (6,775 stops)
- Checked: duplicate stop IDs → **0 duplicates**
- Checked: empty/missing IDs → **0**
- Checked: empty names (both TC and EN) → **0**

**Note:** KMB/CTB route *stop sequences* are fetched **live** from official APIs at runtime (`data.etabus.gov.hk`, `rt.data.gov.hk`), not from bundled files. The bundled files are only the route master list and stop master list.

---

## 2. GMB (Green Minibus) Data ✅ CLEAN

**`public/gmb/index.json`** (912 route-direction entries)
- Duplicate (region, code, route_seq) → **0**
- Duplicate `route_id` values: 339 — **all legitimate** (same `route_id` with different `route_seq` = different directions of the same route; verified no `route_id` has duplicate `route_seq`, and region/code are consistent per `route_id`)
- All 912 entries have a corresponding `gmb/routes/{region}-{code}.json` file → **0 missing files**

**`public/gmb/routes/*.json`** (573 files, 912 directions)
- Directions with duplicate `seq` numbers → **0**
- Directions with empty `stop_id` → **0**

**Spot check — 44B1:**
- Index: 2 entries (NT-44B1 seq 1: 皇崗口岸→屯門碼頭 15 stops; seq 2: 屯門碼頭→皇崗口岸 13 stops)
- Route file `NT-44B1.json`: 2 directions, stop counts match index (15/13) ✅

---

## 3. MTR Data ⚠️ ISSUES FOUND

### 3a. Train stations & Light Rail ✅ CLEAN
- `mtr/train-stations.json`: 121 stations across all lines, **0 duplicate codes**
- `mtr/light-rail.json`: 68 stops, **0 duplicate keys**

### 3b. MTR Bus route files ❌ CORRUPTED (8 files)

**8 of 41 files have duplicate `seq` numbers** — stops from what appear to be two different service patterns are interleaved with the same sequence numbers:

| File | Stops | Duplicate seqs | Example |
|---|---|---|---|
| `506-O.json` | 17 | 5 (seq 1–5 doubled) | — |
| `K51-O.json` | 36 | 5 | — |
| `K52-O.json` | 48 | 18 (seq 1–18 doubled) | seq 1: 悅湖山莊 **and** 輕鐵屯門站 |
| `K66-O.json` | 80 | 21 | — |
| `K68-O.json` | 101 | 23 | — |
| `K73-O.json` | 29 | 9 | — |
| `K75P-O.json` | 31 | 8 | — |
| `K75S-O.json` | 13 | 8 | — |

**Concrete example — `K52-O.json`:**
```
seq 1: 悅湖山莊 (K52-nU010)     ← real K52 stop
seq 1: 輕鐵屯門站 (K52-nU140)    ← different stop, same seq!
seq 2: 邁亞美海灣 (K52-nU020)
seq 2: 輕鐵建安站 (K52-nU150)
...
seq 23-30: single entries (政府車場 → 龍鼓灘）
```

The interleaved stops (nU140–nU200 series: 輕鐵屯門站， 輕鐵建安站， 輕鐵青雲站…) do **not** belong to the K52 悅湖山莊↔龍鼓灘 service pattern. This looks like the scraper merged two MTR data feeds or two service variants into one file.

**User impact:** The app's route detail page sorts by `seq` and displays "第1站、第2站…". With duplicate seqs, users will see **two "第1站", two "第2站"**, etc. — exactly the kind of "垃圾" (garbage) data RB3 fears.

**Inbound (`-I`) files:** Only `-O` (outbound) files are affected. All `-I` files checked are clean.

**Recommended fix:** Re-scrape these 8 routes from the MTR open data source, keeping only the correct service pattern per file. Alternatively, if the MTR API legitimately returns variant patterns, the app should pick one canonical pattern per direction.

---

## 4. CTB Data ✅ CLEAN

- `ctb/stop-routes.json`: 2,594 stops mapped to route lists (reverse lookup); B15 present in 36 stops ✅
- `ctb/oneway.json`: one-way route metadata ✅
- CTB route stop sequences are fetched **live** from `rt.data.gov.hk` at runtime

---

## 5. Live API Spot Checks

### KMB 68X ✅
- `GET /v1/transport/kmb/route-stop/68X/outbound/1` → **31 stops**, seq 1–31, **0 duplicates**
- Matches the app's displayed "68X · 31 個站" ✅
- `service_type 2` → 0 stops (no special departures) ✅
- **Conclusion:** The 68X data RB3 questioned is **correct** — the issue was display truncation ("YL9..."), not data. Already fixed in v1.1.3 (line-clamp-2).

### CTB B15 ✅
- `GET /v2/transport/citybus/route/CTB/B15` → 皇崗口岸 → 屯門青山灣 ✅
- Outbound: **21 stops**, 0 dup seq ✅
- Inbound: **19 stops**, 0 dup seq ✅
- Matches the app's audited "outbound 21 站 / inbound 19 站" ✅

### GMB 44B1 ✅
- Bundled data verified (see §2 above); stop counts match index ✅

---

## 6. Missing / Empty ID Summary

| Check | Result |
|---|---|
| KMB stops with empty ID | 0 |
| GMB stops with empty `stop_id` | 0 |
| MTR bus stops with empty `stop_id` | 0 |
| GMB index entries with missing route file | 0 |
| KMB routes with missing fields | 0 |

**No missing or empty IDs found in any bundled file.**

---

## 7. Recommendations Before Publishing

### 🔴 MUST FIX
1. **Rebuild the 8 corrupted MTR Bus `-O` files** (`506-O`, `K51-O`, `K52-O`, `K66-O`, `K68-O`, `K73-O`, `K75P-O`, `K75S-O`). Each should contain exactly one stop per `seq` number. Verify against the MTR open data portal or the live MTR Bus API.

### 🟡 SHOULD DO
2. Add a **build-time validation script** that fails the build if any bundled route file has duplicate `seq` numbers. This prevents regressions.
3. Consider adding a runtime guard in `getRouteStops()` that deduplicates by `seq` (keep first) as a safety net.

### 🟢 NO ACTION NEEDED
- KMB, GMB, CTB, MTR train/light-rail data: all clean
- Live API integrations (KMB/CTB route stops): verified working, no duplicates
- 68X "wrong numbers" concern: confirmed as display truncation only, data is correct

---

## Appendix: Audit Method

- All checks run via Python 3 against files in `~/workspace/bus-eta-fork/public/`
- Duplicate detection: `collections.Counter` on (route,bound,service_type), stop IDs, (region,code,route_seq), `route_id`, and per-direction `seq` numbers
- Live API checks via `curl` on 2026-10-19 23:15 HKT:
  - `https://data.etabus.gov.hk/v1/transport/kmb/route-stop/68X/outbound/1`
  - `https://rt.data.gov.hk/v2/transport/citybus/route/CTB/B15`
  - `https://rt.data.gov.hk/v2/transport/citybus/route-stop/CTB/B15/outbound` and `/inbound`
- KMB/CTB stop sequences are **not bundled** — they are fetched live, so they cannot have "bundled duplicates"
