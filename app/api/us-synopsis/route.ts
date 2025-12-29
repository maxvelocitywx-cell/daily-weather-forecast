import OpenAI from "openai";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          "OPENAI_API_KEY missing. Set it in Vercel Project → Settings → Environment Variables, then redeploy."
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const client = new OpenAI({ apiKey });

  const nwsRes = await fetch("https://api.weather.gov/alerts/active", {
    headers: { "User-Agent": "MaxVelocityWX (contact: you@example.com)" }
  });

  if (!nwsRes.ok) {
    return new Response(JSON.stringify({ error: "Failed to fetch NWS alerts" }), {
      status: 502,
      headers: { "content-type": "application/json" }
    });
  }

  const nws = await nwsRes.json();

  const counts: Record<string, number> = {};
  for (const f of (nws.features || []).slice(0, 1500)) {
    const e = f?.properties?.event || "Unknown";
    counts[e] = (counts[e] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const resp = await client.responses.create({
    model: "o4-mini",
    reasoning: { effort: "low" },
    instructions:
      "Write a professional 2-paragraph synopsis of weather across the United States today. " +
      "No emojis. Paragraph 1: dominant hazards/trends. Paragraph 2: quieter regions + temps. " +
      "Keep it tight and non-hypey unless hazards warrant. Return exactly two paragraphs.",
    input: `NOAA/NWS alerts summary: ${JSON.stringify({
      total_alerts: (nws.features || []).length,
      top_events: top
    })}`
  });

  const text = resp.output_text.trim();
  const paragraphs = text.split(/\n\s*\n/).slice(0, 2);
const headers = {
  "content-type": "application/json",
  "cache-control": "s-maxage=3600, stale-while-revalidate=300",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type"
};

return new Response(
  JSON.stringify({
    updated_utc: new Date().toISOString(),
    paragraphs
  }),
  { headers }
);
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type"
    }
  });
}


