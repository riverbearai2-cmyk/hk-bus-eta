// Vercel serverless function: MTR Next Train proxy
// Add to your existing hengfuk-gmb-proxy project as api/mtr-proxy.js
// Forwards to https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php
// and adds CORS headers (the MTR API has no CORS, browsers can't call it directly)

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { line, sta, lang } = req.query;

  // Validate: line and sta are required, must be alphanumeric (prevent SSRF)
  if (!line || !sta || !/^[A-Z]{3}$/.test(line) || !/^[A-Z]{3}$/.test(sta)) {
    return res.status(400).json({ error: "Missing or invalid line/sta (expect 3-letter codes)" });
  }

  const l = lang === "TC" || lang === "EN" ? lang : "TC";
  const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${sta}&lang=${l}`;

  try {
    const upstream = await fetch(url, { headers: { "User-Agent": "hk-bus-eta/1.0" } });
    const data = await upstream.json();
    // Cache for 10s (API updates every 10s)
    res.setHeader("Cache-Control", "public, max-age=10");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "Upstream MTR API failed", detail: String(e) });
  }
}
