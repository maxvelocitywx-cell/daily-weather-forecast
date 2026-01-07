/**
 * National/Day metrics aggregation from region data
 * Computes weighted aggregation with tilt toward significant events
 * Not max-only - uses blended approach across all regions
 */

import { RegionId, RiskLevel, RiskDriver, RiskBreakdownItem } from './types';
import { RegionDayMetrics, RegionHazardMetrics, RegionRiskExplain } from './regionMetrics';

// ============================================================================
// Types
// ============================================================================

export interface NationalHazardSummary {
  // Snow aggregate
  snow_max: number;
  snow_p90_max: number;
  regions_with_snow: number;  // >= 1" somewhere
  regions_with_heavy_snow: number;  // >= 4" p90

  // Rain aggregate
  rain_max: number;
  rain_p90_max: number;
  regions_with_rain: number;  // >= 0.25" somewhere
  regions_with_heavy_rain: number;  // >= 1" p90

  // Wind aggregate
  wind_max: number;
  wind_p90_max: number;
  regions_windy: number;  // >= 30 mph p90

  // Temperature extremes
  temp_min_coldest: number;
  temp_max_hottest: number;
  regions_cold: number;  // p10 <= 20°F
  regions_extreme_cold: number;  // p10 <= 0°F
  regions_hot: number;  // p90 >= 95°F
  regions_extreme_hot: number;  // p90 >= 100°F

  // Overlays
  regions_spc: number;
  spc_max?: 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';
  regions_ero: number;
  ero_max?: 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';
}

export interface NationalRiskBreakdown {
  regions_low: number;     // < 3.0
  regions_moderate: number; // 3.0 - 4.99
  regions_elevated: number; // 5.0 - 6.99
  regions_high: number;     // >= 7.0
  highest_region: RegionId;
  highest_score: number;
  hazard_class: 'winter' | 'rain-flood' | 'severe' | 'wind-temp' | 'mixed' | 'quiet';
}

export interface NationalRiskExplain {
  summary_text: string;
  top_drivers: RiskDriver[];
  breakdown: RiskBreakdownItem[];
  regional_breakdown: NationalRiskBreakdown;
  hazards: NationalHazardSummary;
}

export interface NationalDayMetrics {
  dayIndex: number;  // 1-7
  date: string;

  // Aggregated risk
  risk_weighted: number;
  risk_max: number;
  risk_avg: number;
  risk_level: RiskLevel;

  // Regional distribution
  regionScores: Record<RegionId, number>;
  regionLevels: Record<RegionId, RiskLevel>;

  // Explainability
  explain: NationalRiskExplain;

  // Total cities
  totalCities: number;
}

// ============================================================================
// Constants
// ============================================================================

// Region weights based on population/area significance
const REGION_WEIGHTS: Record<RegionId, number> = {
  northeast: 1.15,      // High population density
  southeast: 1.10,      // Large area + population
  midwest: 1.05,        // Population center
  southern_plains: 1.00,
  northern_plains: 0.95,
  southwest: 1.00,
  northwest: 0.90,
};

const ALL_REGIONS: RegionId[] = [
  'northeast', 'southeast', 'midwest',
  'southern_plains', 'northern_plains',
  'southwest', 'northwest'
];

// ============================================================================
// Helper functions
// ============================================================================

function spcOrder(cat?: string): number {
  if (!cat) return 0;
  const order: Record<string, number> = {
    'MRGL': 1, 'SLGT': 2, 'ENH': 3, 'MDT': 4, 'HIGH': 5
  };
  return order[cat] || 0;
}

function eroOrder(cat?: string): number {
  if (!cat) return 0;
  const order: Record<string, number> = {
    'MRGL': 1, 'SLGT': 2, 'MDT': 3, 'HIGH': 4
  };
  return order[cat] || 0;
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 9.5) return 'extreme';
  if (score >= 8.5) return 'severe';
  if (score >= 7.5) return 'major';
  if (score >= 6.5) return 'significant';
  if (score >= 5.5) return 'high';
  if (score >= 4.5) return 'elevated';
  if (score >= 3.5) return 'active';
  if (score >= 2.5) return 'marginal';
  if (score >= 1.5) return 'quiet';
  return 'very-quiet';
}

// ============================================================================
// Main aggregation function
// ============================================================================

export function computeNationalDayMetrics(
  dayIndex: number,
  date: string,
  regionMetrics: RegionDayMetrics[]
): NationalDayMetrics {
  if (regionMetrics.length === 0) {
    return createEmptyNationalMetrics(dayIndex, date);
  }

  // Build region score maps
  const regionScores: Record<RegionId, number> = {} as Record<RegionId, number>;
  const regionLevels: Record<RegionId, RiskLevel> = {} as Record<RegionId, RiskLevel>;

  for (const region of regionMetrics) {
    regionScores[region.regionId] = region.risk_blended;
    regionLevels[region.regionId] = region.risk_level;
  }

  // Fill missing regions with default
  for (const rid of ALL_REGIONS) {
    if (regionScores[rid] === undefined) {
      regionScores[rid] = 1.0;
      regionLevels[rid] = 'very-quiet';
    }
  }

  // ===== COMPUTE NATIONAL HAZARD SUMMARY =====
  const hazards = computeNationalHazards(regionMetrics);

  // ===== COMPUTE WEIGHTED NATIONAL SCORE =====
  // Formula: weighted average with tilt toward significant events

  // Step 1: Weighted average baseline
  let totalWeight = 0;
  let weightedSum = 0;

  for (const region of regionMetrics) {
    const weight = REGION_WEIGHTS[region.regionId] || 1.0;
    weightedSum += region.risk_blended * weight;
    totalWeight += weight;
  }

  const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 1.0;

  // Step 2: Significant event boost
  // Count regions at different thresholds
  const regionsHigh = regionMetrics.filter(r => r.risk_blended >= 7.0).length;
  const regionsElevated = regionMetrics.filter(r => r.risk_blended >= 5.0).length;
  const regionsModerate = regionMetrics.filter(r => r.risk_blended >= 3.0).length;

  let significanceBoost = 0;
  if (regionsHigh >= 3) {
    significanceBoost = 1.5;  // Major multi-region event
  } else if (regionsHigh >= 2) {
    significanceBoost = 1.0;
  } else if (regionsHigh >= 1) {
    significanceBoost = 0.6;
  } else if (regionsElevated >= 3) {
    significanceBoost = 0.5;
  } else if (regionsElevated >= 2) {
    significanceBoost = 0.3;
  } else if (regionsModerate >= 4) {
    significanceBoost = 0.2;
  }

  // Step 3: Max region tilt (don't ignore significant local events)
  const risk_max = Math.max(...regionMetrics.map(r => r.risk_blended));
  const maxTilt = (risk_max - weightedAvg) * 0.2;

  // Step 4: Combine
  let risk_weighted = weightedAvg + significanceBoost + maxTilt;

  // Clamp
  risk_weighted = Math.max(1.0, Math.min(10.0, risk_weighted));

  // ===== BUILD EXPLAINABILITY =====
  const regionalBreakdown: NationalRiskBreakdown = {
    regions_low: regionMetrics.filter(r => r.risk_blended < 3.0).length,
    regions_moderate: regionMetrics.filter(r => r.risk_blended >= 3.0 && r.risk_blended < 5.0).length,
    regions_elevated: regionMetrics.filter(r => r.risk_blended >= 5.0 && r.risk_blended < 7.0).length,
    regions_high: regionMetrics.filter(r => r.risk_blended >= 7.0).length,
    highest_region: regionMetrics.reduce((max, r) =>
      r.risk_blended > (regionScores[max] || 0) ? r.regionId : max,
      regionMetrics[0]?.regionId || 'northeast'
    ),
    highest_score: risk_max,
    hazard_class: determineNationalHazardClass(regionMetrics, hazards),
  };

  const breakdown = buildNationalBreakdown(regionMetrics, hazards, regionalBreakdown);
  const topDrivers = buildNationalDrivers(regionMetrics, hazards);
  const summary_text = generateNationalSummary(
    regionalBreakdown,
    hazards,
    risk_weighted,
    dayIndex
  );

  const explain: NationalRiskExplain = {
    summary_text,
    top_drivers: topDrivers,
    breakdown,
    regional_breakdown: regionalBreakdown,
    hazards,
  };

  // Total city count
  const totalCities = regionMetrics.reduce((sum, r) => sum + r.cityCount, 0);

  return {
    dayIndex,
    date,
    risk_weighted: Math.round(risk_weighted * 100) / 100,
    risk_max: Math.round(risk_max * 100) / 100,
    risk_avg: Math.round(weightedAvg * 100) / 100,
    risk_level: scoreToLevel(risk_weighted),
    regionScores,
    regionLevels,
    explain,
    totalCities,
  };
}

function computeNationalHazards(regions: RegionDayMetrics[]): NationalHazardSummary {
  const summary: NationalHazardSummary = {
    snow_max: 0,
    snow_p90_max: 0,
    regions_with_snow: 0,
    regions_with_heavy_snow: 0,
    rain_max: 0,
    rain_p90_max: 0,
    regions_with_rain: 0,
    regions_with_heavy_rain: 0,
    wind_max: 0,
    wind_p90_max: 0,
    regions_windy: 0,
    temp_min_coldest: 100,
    temp_max_hottest: -100,
    regions_cold: 0,
    regions_extreme_cold: 0,
    regions_hot: 0,
    regions_extreme_hot: 0,
    regions_spc: 0,
    regions_ero: 0,
  };

  for (const region of regions) {
    // Snow
    if (region.snow_max > summary.snow_max) summary.snow_max = region.snow_max;
    if (region.snow_p90 > summary.snow_p90_max) summary.snow_p90_max = region.snow_p90;
    if (region.snow_max >= 1) summary.regions_with_snow++;
    if (region.snow_p90 >= 4) summary.regions_with_heavy_snow++;

    // Rain
    if (region.rain_max > summary.rain_max) summary.rain_max = region.rain_max;
    if (region.rain_p90 > summary.rain_p90_max) summary.rain_p90_max = region.rain_p90;
    if (region.rain_max >= 0.25) summary.regions_with_rain++;
    if (region.rain_p90 >= 1) summary.regions_with_heavy_rain++;

    // Wind
    if (region.wind_gust_max > summary.wind_max) summary.wind_max = region.wind_gust_max;
    if (region.wind_gust_p90 > summary.wind_p90_max) summary.wind_p90_max = region.wind_gust_p90;
    if (region.wind_gust_p90 >= 30) summary.regions_windy++;

    // Temperature
    if (region.temp_min_p10 < summary.temp_min_coldest) summary.temp_min_coldest = region.temp_min_p10;
    if (region.temp_max_p90 > summary.temp_max_hottest) summary.temp_max_hottest = region.temp_max_p90;
    if (region.temp_min_p10 <= 20) summary.regions_cold++;
    if (region.temp_min_p10 <= 0) summary.regions_extreme_cold++;
    if (region.temp_max_p90 >= 95) summary.regions_hot++;
    if (region.temp_max_p90 >= 100) summary.regions_extreme_hot++;

    // Overlays
    if (region.spc_max) {
      summary.regions_spc++;
      if (!summary.spc_max || spcOrder(region.spc_max) > spcOrder(summary.spc_max)) {
        summary.spc_max = region.spc_max;
      }
    }
    if (region.ero_max) {
      summary.regions_ero++;
      if (!summary.ero_max || eroOrder(region.ero_max) > eroOrder(summary.ero_max)) {
        summary.ero_max = region.ero_max;
      }
    }
  }

  return summary;
}

function determineNationalHazardClass(
  regions: RegionDayMetrics[],
  hazards: NationalHazardSummary
): NationalRiskBreakdown['hazard_class'] {
  // Count hazard classes from regions
  const classCounts: Record<string, number> = {
    winter: 0,
    'rain-flood': 0,
    severe: 0,
    'wind-temp': 0,
    quiet: 0,
  };

  for (const region of regions) {
    if (region.explain.hazard_class) {
      classCounts[region.explain.hazard_class]++;
    }
  }

  // If severe weather is present anywhere with high risk, prioritize
  if (hazards.regions_spc >= 1 && hazards.spc_max && spcOrder(hazards.spc_max) >= 3) {
    return 'severe';
  }

  // Check for dominant class
  const entries = Object.entries(classCounts).filter(([k]) => k !== 'quiet');
  entries.sort((a, b) => b[1] - a[1]);

  if (entries.length === 0 || entries[0][1] === 0) {
    return 'quiet';
  }

  // If multiple classes are significant, it's mixed
  if (entries.length >= 2 && entries[0][1] > 0 && entries[1][1] > 0 &&
      entries[0][1] - entries[1][1] <= 1) {
    return 'mixed';
  }

  return entries[0][0] as NationalRiskBreakdown['hazard_class'];
}

function buildNationalBreakdown(
  regions: RegionDayMetrics[],
  hazards: NationalHazardSummary,
  breakdown: NationalRiskBreakdown
): RiskBreakdownItem[] {
  const items: RiskBreakdownItem[] = [];

  // Regional distribution
  items.push({
    category: 'Regional Distribution',
    contribution: breakdown.regions_high * 1.5 + breakdown.regions_elevated * 0.8,
    details: `${breakdown.regions_high} high (≥7), ${breakdown.regions_elevated} elevated (5-7), ${breakdown.regions_moderate} moderate (3-5), ${breakdown.regions_low} low (<3)`,
  });

  // Snow impact
  if (hazards.regions_with_snow > 0) {
    items.push({
      category: 'Snow Impacts',
      contribution: hazards.regions_with_heavy_snow * 1.2 + hazards.regions_with_snow * 0.3,
      details: `${hazards.regions_with_snow} regions with snow, ${hazards.regions_with_heavy_snow} with heavy (p90 ≥4"). Max: ${hazards.snow_max.toFixed(1)}"`,
    });
  }

  // Rain impact
  if (hazards.regions_with_rain > 0) {
    items.push({
      category: 'Rain Impacts',
      contribution: hazards.regions_with_heavy_rain * 0.8 + hazards.regions_with_rain * 0.2,
      details: `${hazards.regions_with_rain} regions with rain, ${hazards.regions_with_heavy_rain} with heavy (p90 ≥1"). Max: ${hazards.rain_max.toFixed(2)}"`,
    });
  }

  // Severe weather
  if (hazards.regions_spc > 0) {
    items.push({
      category: 'Severe Weather',
      contribution: spcOrder(hazards.spc_max) * 1.5,
      details: `${hazards.regions_spc} regions in SPC outlook. Max category: ${hazards.spc_max}`,
    });
  }

  // Wind
  if (hazards.regions_windy > 0) {
    items.push({
      category: 'Wind Impacts',
      contribution: hazards.regions_windy * 0.4,
      details: `${hazards.regions_windy} regions with elevated winds (p90 ≥30 mph). Max gust: ${hazards.wind_max} mph`,
    });
  }

  // Cold
  if (hazards.regions_cold > 0) {
    items.push({
      category: 'Cold Impacts',
      contribution: hazards.regions_extreme_cold * 0.8 + hazards.regions_cold * 0.3,
      details: `${hazards.regions_cold} regions cold (p10 ≤20°F), ${hazards.regions_extreme_cold} extreme cold (p10 ≤0°F). Coldest: ${hazards.temp_min_coldest}°F`,
    });
  }

  // Heat
  if (hazards.regions_hot > 0) {
    items.push({
      category: 'Heat Impacts',
      contribution: hazards.regions_extreme_hot * 0.8 + hazards.regions_hot * 0.3,
      details: `${hazards.regions_hot} regions hot (p90 ≥95°F), ${hazards.regions_extreme_hot} extreme (p90 ≥100°F). Hottest: ${hazards.temp_max_hottest}°F`,
    });
  }

  // ERO
  if (hazards.regions_ero > 0) {
    items.push({
      category: 'Excessive Rainfall',
      contribution: eroOrder(hazards.ero_max) * 0.8,
      details: `${hazards.regions_ero} regions in ERO outlook. Max category: ${hazards.ero_max}`,
    });
  }

  return items.sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));
}

function buildNationalDrivers(
  regions: RegionDayMetrics[],
  hazards: NationalHazardSummary
): RiskDriver[] {
  const drivers: RiskDriver[] = [];

  // Collect from all regions
  const driverMap: Record<string, { totalScore: number; count: number; maxValue: number; unit: string }> = {};

  for (const region of regions) {
    for (const driver of region.explain.top_drivers) {
      if (!driverMap[driver.hazard]) {
        driverMap[driver.hazard] = { totalScore: 0, count: 0, maxValue: 0, unit: driver.unit ?? '' };
      }
      driverMap[driver.hazard].totalScore += driver.score;
      driverMap[driver.hazard].count++;
      if ((driver.rawValue ?? 0) > driverMap[driver.hazard].maxValue) {
        driverMap[driver.hazard].maxValue = driver.rawValue ?? 0;
      }
    }
  }

  // Convert to drivers
  for (const [hazard, data] of Object.entries(driverMap)) {
    if (data.count >= 2 || data.totalScore >= 2) {  // Only significant national hazards
      drivers.push({
        hazard,
        score: Math.round((data.totalScore / regions.length) * 10) / 10,
        rawValue: data.maxValue,
        unit: data.unit,
        description: `${data.count} regions affected`,
      });
    }
  }

  return drivers.sort((a, b) => b.score - a.score).slice(0, 5);
}

function generateNationalSummary(
  breakdown: NationalRiskBreakdown,
  hazards: NationalHazardSummary,
  score: number,
  dayIndex: number
): string {
  const sentences: string[] = [];
  const totalRegions = breakdown.regions_low + breakdown.regions_moderate +
                       breakdown.regions_elevated + breakdown.regions_high;

  if (score < 2.0) {
    return 'Quiet weather expected across the nation with no significant hazards.';
  }

  // Lead with overall impact level
  if (breakdown.regions_high >= 3) {
    sentences.push(`Major weather event affecting ${breakdown.regions_high} of ${totalRegions} regions.`);
  } else if (breakdown.regions_high >= 1) {
    sentences.push(`Significant impacts in ${breakdown.regions_high} region${breakdown.regions_high > 1 ? 's' : ''}, with elevated conditions in ${breakdown.regions_elevated} more.`);
  } else if (breakdown.regions_elevated >= 2) {
    sentences.push(`Elevated weather activity across ${breakdown.regions_elevated} regions.`);
  } else if (breakdown.regions_moderate >= 3) {
    sentences.push(`Moderate weather activity in ${breakdown.regions_moderate} regions.`);
  }

  // Hazard-specific details
  if (breakdown.hazard_class === 'winter' || hazards.regions_with_heavy_snow >= 2) {
    sentences.push(`Winter weather impacts with snow in ${hazards.regions_with_snow} regions (max ${hazards.snow_max.toFixed(1)}").`);
  }

  if (breakdown.hazard_class === 'severe' || (hazards.spc_max && spcOrder(hazards.spc_max) >= 3)) {
    sentences.push(`Severe weather threat with ${hazards.spc_max} risk in ${hazards.regions_spc} region${hazards.regions_spc > 1 ? 's' : ''}.`);
  }

  if (breakdown.hazard_class === 'rain-flood' || hazards.regions_with_heavy_rain >= 2) {
    sentences.push(`Heavy rain impacts across ${hazards.regions_with_rain} regions.`);
  }

  if (hazards.regions_extreme_cold >= 2) {
    sentences.push(`Dangerous cold across ${hazards.regions_extreme_cold} regions with lows near ${hazards.temp_min_coldest}°F.`);
  }

  if (hazards.regions_extreme_hot >= 2) {
    sentences.push(`Excessive heat in ${hazards.regions_extreme_hot} regions with highs near ${hazards.temp_max_hottest}°F.`);
  }

  // Confidence note for extended range
  if (dayIndex >= 5) {
    sentences.push('Extended range forecast; confidence is lower.');
  }

  return sentences.join(' ');
}

function createEmptyNationalMetrics(dayIndex: number, date: string): NationalDayMetrics {
  const regionScores: Record<RegionId, number> = {} as Record<RegionId, number>;
  const regionLevels: Record<RegionId, RiskLevel> = {} as Record<RegionId, RiskLevel>;

  for (const rid of ALL_REGIONS) {
    regionScores[rid] = 1.0;
    regionLevels[rid] = 'very-quiet';
  }

  return {
    dayIndex,
    date,
    risk_weighted: 1.0,
    risk_max: 1.0,
    risk_avg: 1.0,
    risk_level: 'very-quiet',
    regionScores,
    regionLevels,
    explain: {
      summary_text: 'No data available.',
      top_drivers: [],
      breakdown: [],
      regional_breakdown: {
        regions_low: 7,
        regions_moderate: 0,
        regions_elevated: 0,
        regions_high: 0,
        highest_region: 'northeast',
        highest_score: 1.0,
        hazard_class: 'quiet',
      },
      hazards: {
        snow_max: 0, snow_p90_max: 0, regions_with_snow: 0, regions_with_heavy_snow: 0,
        rain_max: 0, rain_p90_max: 0, regions_with_rain: 0, regions_with_heavy_rain: 0,
        wind_max: 0, wind_p90_max: 0, regions_windy: 0,
        temp_min_coldest: 32, temp_max_hottest: 50,
        regions_cold: 0, regions_extreme_cold: 0,
        regions_hot: 0, regions_extreme_hot: 0,
        regions_spc: 0, regions_ero: 0,
      },
    },
    totalCities: 0,
  };
}

/**
 * Compute all 7 days of national metrics
 */
export function computeAllNationalMetrics(
  allRegionMetrics: RegionDayMetrics[][]  // [dayIndex-1][regionIndex]
): NationalDayMetrics[] {
  const results: NationalDayMetrics[] = [];

  for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
    const dayRegions = allRegionMetrics[dayIdx] || [];
    const date = dayRegions[0]?.date || new Date().toISOString().split('T')[0];
    results.push(computeNationalDayMetrics(dayIdx + 1, date, dayRegions));
  }

  return results;
}
