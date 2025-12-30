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
Weather Context for US Regions:

WEST (California, Oregon, Washington, Nevada, Arizona):
Day 1: Mild and dry across most of the West. Highs in the 50s-60s for coastal California, 40s-50s for the Pacific Northwest. Light winds. Some morning fog possible in the Central Valley.
Day 2: A weak system brings light rain to Seattle and Portland, 0.1-0.3 inches expected. Dry and mild in California with highs near 60 in LA and San Francisco.
Day 3: Clearing in the Pacific Northwest. Dry conditions persist across the Southwest. Phoenix sees highs near 65, Las Vegas in the low 50s.
Days 4-7: Pattern remains quiet with near-normal temperatures and minimal precipitation chances.

ROCKIES (Colorado, Wyoming, Montana, Utah, Idaho):
Day 1: Cool and quiet across the Rockies. Denver highs in the upper 30s, lows in the teens. Light winds. Some high clouds but dry.
Day 2: A clipper system brings light snow to Montana and northern Wyoming, 1-3 inches possible in the mountains. Denver remains dry with highs in the low 40s.
Day 3: Snow showers taper off. Cold nights continue with lows in the single digits for Montana. Salt Lake City sees highs near 40.
Days 4-7: Temperatures trend slightly above normal. Dry conditions expected through the period.

PLAINS (Kansas, Nebraska, Oklahoma, Texas Panhandle, Dakotas):
Day 1: Seasonably cool across the Plains. Highs in the 30s-40s for the northern Plains, 50s for Oklahoma. Winds light out of the north at 5-10 mph.
Day 2: A reinforcing cold front drops temperatures. Highs only in the 20s for the Dakotas, 40s for Kansas. Winds increase to 15-25 mph.
Day 3: Cold but dry. Omaha highs in the mid-30s, Oklahoma City near 50. Winds diminish.
Days 4-7: Gradual warming trend with temperatures returning to near normal by day 6.

MIDWEST/GREAT LAKES (Michigan, Ohio, Indiana, Illinois, Wisconsin, Minnesota):
Day 1: Lake-effect snow continues downwind of Lakes Erie and Ontario. Buffalo could see 4-8 inches, Cleveland 1-3 inches. Chicago dry but cold, highs in the low 30s.
Day 2: Lake-effect snow tapers off. Cold and blustery with highs in the 20s-30s. Winds 15-25 mph with gusts to 35 mph.
Day 3: Clearing skies. Detroit highs near 35, Minneapolis in the upper 20s. Calmer winds.
Days 4-7: Quiet pattern with temperatures near to slightly above normal.

SOUTH (Texas, Louisiana, Arkansas, Mississippi):
Day 1: Mild and mostly dry. Houston highs in the upper 50s, Dallas near 50. Light south winds.
Day 2: A cold front pushes through bringing a brief cool-down. Highs drop to the 40s-50s. Some light rain possible in Louisiana, under 0.25 inches.
Day 3: Cool but dry. New Orleans highs in the low 50s, San Antonio near 55. Light north winds.
Days 4-7: Gradual warming trend with temperatures returning to the 60s by day 6.

SOUTHEAST (Florida, Georgia, Alabama, Tennessee, Carolinas, Virginia):
Day 1: Mild and dry. Atlanta highs in the upper 50s, Miami near 75. Light winds.
Day 2: Slight cool-down as a weak front passes. Highs in the 50s for Tennessee and the Carolinas, 70s for Florida.
Day 3: Dry conditions continue. Charlotte highs near 55, Tampa in the low 70s.
Days 4-7: Quiet weather pattern with temperatures near normal.

NORTHEAST (New York, Pennsylvania, New Jersey, New England, Maryland, Delaware):
Day 1: Rain spreads into NYC and Boston by morning, changing to snow inland across upstate NY, Vermont, and New Hampshire by late afternoon. Coastal wind gusts 40-45 mph. Snow accumulations: Buffalo 6-10 inches from lake-effect, Rochester 2-4 inches, Syracuse 1-2 inches. Philadelphia sees rain only, 0.5-1 inch.
Day 2: Cold and blustery with scattered snow showers. Highs in the 30s, lows in the 20s. Winds 15-25 mph with gusts to 35 mph. Light accumulations under 1 inch for most areas.
Day 3: Clearing skies and calming winds. Boston highs in the upper 30s, NYC near 40. Much calmer conditions.
Days 4-7: Gradual warming trend with temperatures approaching 45-50 by day 6. Dry conditions expected.

IMPORTANT: You MUST generate forecast data for ALL 7 regions: west, rockies, plains, midwest_greatlakes, south, southeast, northeast.
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
