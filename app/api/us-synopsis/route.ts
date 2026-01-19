import OpenAI from "openai";
import { CITIES } from "@/lib/cities";
import { fetchOpenMeteoForecast } from "@/lib/openMeteo";
import { REGION_IDS, REGIONS } from "@/lib/regions";
import { RegionId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RegionSummary {
  regionId: RegionId;
  regionName: string;
  avgHigh: number;
  avgLow: number;
  maxRain: number;
  maxSnow: number;
  maxGust: number;
  topCities: Array<{ name: string; high: number; low: number; rain: number; snow: number }>;
}

async function fetchRegionSummary(regionId: RegionId): Promise<RegionSummary | null> {
  const cities = CITIES.filter(c => c.regionId === regionId).slice(0, 8);
  if (cities.length === 0) return null;

  const cityData: Array<{ name: string; high: number; low: number; rain: number; snow: number; gust: number }> = [];

  const promises = cities.map(async (city) => {
    try {
      const data = await fetchOpenMeteoForecast(city.lat, city.lon, {
        hourly: false,
        daily: true,
        days: 1,
      });
      if (!data.daily) return null;
      return {
        name: city.name,
        high: Math.round(data.daily.temperature_2m_max[0] || 50),
        low: Math.round(data.daily.temperature_2m_min[0] || 30),
        rain: Math.round((data.daily.rain_sum?.[0] || data.daily.precipitation_sum?.[0] || 0) * 100) / 100,
        snow: Math.round((data.daily.snowfall_sum?.[0] || 0) * 10) / 10,
        gust: Math.round(data.daily.wind_gusts_10m_max?.[0] || 0),
      };
    } catch {
      return null;
    }
  });

  const results = (await Promise.all(promises)).filter(Boolean) as typeof cityData;

  if (results.length === 0) return null;

  return {
    regionId,
    regionName: REGIONS[regionId].name,
    avgHigh: Math.round(results.reduce((a, c) => a + c.high, 0) / results.length),
    avgLow: Math.round(results.reduce((a, c) => a + c.low, 0) / results.length),
    maxRain: Math.max(...results.map(c => c.rain)),
    maxSnow: Math.max(...results.map(c => c.snow)),
    maxGust: Math.max(...results.map(c => c.gust)),
    topCities: results.slice(0, 4),
  };
}

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

  // Fetch real weather data for all regions
  const regionPromises = REGION_IDS.map(fetchRegionSummary);
  const regionSummaries = (await Promise.all(regionPromises)).filter(Boolean) as RegionSummary[];

  // Also fetch NWS alerts for context
  let alertContext = "";
  try {
    const nwsRes = await fetch("https://api.weather.gov/alerts/active", {
      headers: { "User-Agent": "MaxVelocityWX (contact: weather@example.com)" }
    });

    if (nwsRes.ok) {
      const nws = await nwsRes.json();
      const counts: Record<string, number> = {};
      for (const f of (nws.features || []).slice(0, 1500)) {
        const e = f?.properties?.event || "Unknown";
        counts[e] = (counts[e] || 0) + 1;
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      alertContext = `\n\nActive NWS Alerts: ${(nws.features || []).length} total. Top events: ${top.map(([e, c]) => `${e}: ${c}`).join(', ')}`;
    }
  } catch {
    // Continue without alerts
  }

  // Build weather context
  let weatherContext = "Current US Weather Data by Region:\n\n";
  for (const summary of regionSummaries) {
    weatherContext += `${summary.regionName}:\n`;
    weatherContext += `- Temperatures: Highs averaging ${summary.avgHigh}°F, lows ${summary.avgLow}°F\n`;
    if (summary.maxSnow >= 0.5) {
      weatherContext += `- Snow: Up to ${summary.maxSnow}" in some areas\n`;
    }
    if (summary.maxRain >= 0.25) {
      weatherContext += `- Rain: Up to ${summary.maxRain}" in some areas\n`;
    }
    if (summary.maxGust >= 25) {
      weatherContext += `- Winds: Gusts up to ${summary.maxGust} mph\n`;
    }
    const cityDetails = summary.topCities.map(c => {
      let detail = `${c.name} (${c.high}/${c.low}°F`;
      if (c.snow > 0) detail += `, ${c.snow}" snow`;
      else if (c.rain > 0.1) detail += `, ${c.rain}" rain`;
      detail += ")";
      return detail;
    }).join(", ");
    weatherContext += `- Cities: ${cityDetails}\n\n`;
  }

  weatherContext += alertContext;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a professional weather forecaster writing a national US weather synopsis. Write exactly 2 paragraphs:
- Paragraph 1: Focus on areas with active weather (snow, rain, wind, severe). Mention specific cities and amounts.
- Paragraph 2: Cover quieter regions and temperature trends across the country.
Keep it professional, no emojis, no sensationalism unless warranted by significant impacts. Use the actual data provided.`
      },
      {
        role: "user",
        content: weatherContext
      }
    ],
    max_tokens: 500,
    temperature: 0.5,
  });

  const text = response.choices[0]?.message?.content?.trim() || "";
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
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type"
    }
  });
}


