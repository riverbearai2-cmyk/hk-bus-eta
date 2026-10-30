# HK Bus ETA

Production-ready Next.js app for real-time Hong Kong bus ETAs (KMB + Citybus).

## Features

- Split-screen map (Leaflet) + control panel
- Responsive: side-by-side desktop, bottom sheet mobile
- GPS locate + nearby stops
- Text search for stops / streets
- "Search this area" on map pan
- Real-time ETA with 60s auto-refresh countdown
- SWR client caching + background revalidate
- Favorites via localStorage
- Route number search + path polyline on map
- KMB / CTB operator badges (red / blue)
- Stop merging within ~25m
- Viewport-only marker rendering for performance
- Next.js API route proxies (CORS-free)
- PWA installable (manifest + icons)
- Light minimal 2026 UI with Tailwind

## Tech

- Next.js 14 App Router + TypeScript
- Tailwind CSS
- React-Leaflet + Leaflet
- SWR
- Deploy target: Vercel

## Quick Start

```bash
cd hk-bus-eta
npm install
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

1. Push this folder to a GitHub repo
2. Import in Vercel
3. Deploy (zero config needed)

Or:

```bash
npx vercel
```

## Data Sources

- KMB: https://data.etabus.gov.hk/v1/transport/kmb
- Citybus: https://rt.data.gov.hk/v2/transport/citybus

Static stop lists are fetched once per day via `/api/stops` (server-side cached). ETAs revalidate every ~20-30s.

Note: Full CTB stop list is not provided as a single public dump by the operator in the same way as KMB. The app prioritizes KMB `stop-eta` (returns all routes at a stop) and supports CTB via route search. Merged stops appear when both operators have nearby matching names.

## Project Structure

```
app/
  page.tsx              # Main split layout
  layout.tsx
  globals.css
  api/
    stops/route.ts      # Unified + merged stops
    eta/route.ts        # Normalized real-time ETA
    routes/route.ts     # Route list + path stops
components/
  Map.tsx
  SearchPanel.tsx
hooks/
  useGeolocation.ts
  useFavorites.ts
  useBusData.ts
utils/
  api.ts
  geo.ts
types/
  bus.ts
public/
  manifest.json
  icons/
```

## Notes

- First load of stops may take a few seconds (large JSON from government).
- Geolocation requires HTTPS (Vercel provides it).
- No API keys required. Free open data.
- Light mode only as specified.

## License

MIT. Data © respective operators / HKSAR Government.