import { NextResponse } from "next/server";
import { generateUSWeatherSynopsis } from "@/lib/us-weather-synopsis";

export const runtime = "nodejs";

function isoUtcNow() {
  return new Date().toISOString();
}

function dayName(offsetDays: number) {
  // Use Eastern Time for day labels
  const d = new Date();
  const estString = d.toLocaleString("en-US", { timeZone: "America/New_York" });
  const estDate = new Date(estString);
  estDate.setDate(estDate.getDate() + offsetDays);
  return estDate.toLocaleDateString("en-US", { weekday: "long" });
}

export async function GET() {
  // TEMP TEST CONTEXT (replace later with real SPC/WPC/NWS context)
  const context = `
Weather Context for US Regions:

WEST COAST (California, Oregon, Washington, Idaho, Nevada, Arizona, Utah):
Day 1: Mild and dry across most of the West Coast. Highs in the 50s-60s for coastal California, 40s-50s for the Pacific Northwest. Seattle and Portland see partly cloudy skies. Light winds at 5-10 mph. Some morning fog possible in California's Central Valley reducing visibility. Phoenix and Las Vegas remain sunny with highs in the low 60s.
Day 2: A weak system brings light rain to Seattle and Portland, 0.1-0.3 inches expected. Boise sees a mix of clouds and sun. Dry and mild in California with highs near 60 in LA and San Francisco. Salt Lake City partly cloudy with highs in the low 40s.
Day 3: Clearing in the Pacific Northwest with sunshine returning. Dry conditions persist across the Southwest. Phoenix sees highs near 65, Las Vegas in the low 50s. Winds remain light region-wide.
Days 4-7: Pattern remains quiet with near-normal temperatures and minimal precipitation chances across the region.

ROCKIES (New Mexico, Colorado, Wyoming, Montana):
Day 1: Cool and quiet across the Rockies. Denver highs in the upper 30s, lows in the teens. Light winds at 5-10 mph. Some high clouds but dry conditions. Billings cold with highs only in the 20s. Albuquerque milder with highs near 50.
Day 2: A clipper system brings light snow to Montana and northern Wyoming, 1-3 inches possible in the mountains around Billings and Bozeman. Denver remains dry with highs in the low 40s. Winds increase to 15-20 mph.
Day 3: Snow showers taper off in Montana. Cold nights continue with lows in the single digits for Montana and teens for Wyoming. Denver sees partly cloudy skies with highs in the upper 30s.
Days 4-7: Temperatures trend slightly above normal. Dry conditions expected through the period across the Rockies.

GREAT PLAINS (North Dakota, South Dakota, Nebraska, Kansas, Oklahoma, Texas, Arkansas, Louisiana):
Day 1: Seasonably cool across the Plains. Highs in the 30s-40s for the Dakotas and Nebraska, 50s for Oklahoma and Texas. Winds light out of the north at 5-10 mph. Dallas sees highs near 50, Houston in the upper 50s. Mostly sunny skies.
Day 2: A reinforcing cold front drops temperatures. Highs only in the 20s for the Dakotas, 40s for Kansas and Nebraska. Winds increase to 15-25 mph creating wind chills in the teens for Fargo and Sioux Falls. Some light rain possible in Louisiana, under 0.25 inches.
Day 3: Cold but dry across the northern Plains. Omaha highs in the mid-30s, Oklahoma City near 50. Dallas rebounds to the mid-50s. Winds diminish to 5-10 mph. New Orleans sees highs in the low 50s.
Days 4-7: Gradual warming trend with temperatures returning to near normal by day 6 across the region.

MIDWEST (Minnesota, Iowa, Missouri, Illinois, Indiana, Ohio, Michigan, Wisconsin):
Day 1: Lake-effect snow continues downwind of the Great Lakes. Cleveland could see 2-4 inches, with 1-2 inches for Detroit. Chicago dry but cold, highs in the low 30s. Minneapolis highs in the upper 20s. Winds 10-20 mph.
Day 2: Lake-effect snow tapers off. Cold and blustery with highs in the 20s-30s region-wide. Winds 15-25 mph with gusts to 35 mph making it feel like the teens. Indianapolis and Columbus highs near 30.
Day 3: Clearing skies. Detroit highs near 35, Minneapolis in the upper 20s, Chicago in the low 30s. Calmer winds at 5-10 mph.
Days 4-7: Quiet pattern with temperatures near to slightly above normal across the Midwest.

NORTHEAST (Pennsylvania, New York, New Jersey, Rhode Island, Connecticut, Massachusetts, New Hampshire, Vermont, Maine):
Day 1: Rain spreads into NYC and Boston by morning, changing to snow inland across upstate NY, Vermont, and New Hampshire by late afternoon. Coastal wind gusts 40-45 mph creating dangerous conditions. Snow accumulations: Syracuse 4-6 inches, Albany 3-5 inches, Burlington 5-8 inches. Philadelphia and NYC see rain only, 0.5-1 inch. Portland, ME gets a mix of rain and snow.
Day 2: Cold and blustery with scattered snow showers. Highs in the 30s, lows in the 20s region-wide. Winds 15-25 mph with gusts to 35 mph. Light accumulations under 1 inch for most areas. Travel remains difficult in higher elevations.
Day 3: Clearing skies and calming winds. Boston highs in the upper 30s, NYC near 40, Philadelphia in the low 40s. Much calmer conditions return to the region.
Days 4-7: Gradual warming trend with temperatures approaching 45-50 by day 6. Dry conditions expected throughout the Northeast.

SOUTHEAST (Kentucky, Tennessee, Mississippi, Alabama, Georgia, Florida, South Carolina, North Carolina, Virginia, West Virginia, Washington DC, Maryland, Delaware):
Day 1: Mild and dry across the Southeast. Atlanta highs in the upper 50s, Miami near 75, Charlotte in the mid-50s. Light winds at 5-10 mph. Nashville sees partly cloudy skies with highs in the upper 40s.
Day 2: Slight cool-down as a weak front passes. Highs in the 50s for Tennessee, Kentucky, and the Carolinas, 70s for Florida. Richmond and DC see highs in the upper 40s. Light rain possible in Virginia, under 0.1 inches.
Day 3: Dry conditions continue. Charlotte highs near 55, Tampa in the low 70s, Atlanta in the mid-50s. Winds remain light. Jacksonville sees highs in the upper 60s.
Days 4-7: Quiet weather pattern with temperatures near normal across the Southeast.

IMPORTANT: You MUST generate forecast data for ALL 6 regions in this exact order: west_coast, rockies, great_plains, midwest, northeast, southeast.
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
