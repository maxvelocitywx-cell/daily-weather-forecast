import { NextResponse } from "next/server";
import { generateUSWeatherSynopsis } from "@/lib/us-weather-synopsis";

export const runtime = "nodejs";

function isoUtcNow() {
  return new Date().toISOString();
}

function dayName(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

export async function GET() {
  // TEMP TEST CONTEXT (replace later with real SPC/WPC/NWS context)
  const context = `
Context (sample):
- Northeast: Rain spreads into NYC/Boston Monday morning, then changes to snow late day inland NY/VT/NH. Coastal New England wind gusts 40-45 mph. Lake-effect snow near Buffalo Monday night with visibility reductions. Tuesday cold, blustery, scattered snow showers. Wednesday clearing.
- Midwest/Great Lakes: Lake-effect snow continues near the lakes with minor accumulations; breezy and colder Tuesday.
- Plains: Quiet; seasonably cool.
- South: Mild; mostly dry.
- Southeast: Mild; dry.
- Rockies: Quiet; cool nights.
- West: Quiet; mild; no significant storms.
  `;

  const data = await generateUSWeatherSynopsis(context);

  // Force correct timestamp and day labels every time
  data.updated_utc = isoUtcNow();
  data.day_labels = {
    day1: dayName(0),
    day2: dayName(1),
    day3: dayName(2),
  };

  // Enforce CTA rule: only if risk >= 4.5 OR changed_since_last true
  for (const r of data.regions || []) {
    const risk = Number(r.risk_scale ?? 0);
    const changed = Boolean(r.changed_since_last);
    if (risk < 4.5 && !changed) r.cta = "";
  }

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "s-maxage=3600, stale-while-revalidate=300",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
