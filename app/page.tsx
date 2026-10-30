"use client";

import dynamic from "next/dynamic";

// Lite version: no map, locate-first. Leaflet is never bundled on this page.
const LiteApp = dynamic(() => import("@/components/LiteApp"), {
  ssr: false,
  loading: () => (
    <div className="h-[100dvh] w-full flex items-center justify-center bg-slate-100">
      <div className="bg-white shadow-lg rounded-2xl px-5 py-4 text-sm text-slate-500">
        載入緊…
      </div>
    </div>
  ),
});

export default function LiteHomePage() {
  return <LiteApp />;
}
