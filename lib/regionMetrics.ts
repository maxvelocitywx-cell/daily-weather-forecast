/**
 * Region/Day metrics aggregation from city data
 * Computes percentiles, coverage fractions, and hazard-based scoring
 * Region risk is NOT driven by max city - uses blended approach
 */

import { RegionId, RiskLevel, RiskDriver, RiskBreakdownItem } from './types';

// ============================================================================
// Types
// ============================================================================

export interface CityDayData {
  cityId: string;
  cityName: string;
  state: string;
  lat: number;
  lon: number;
  tmax_f: number;
  tmin_f: number;
  wind_gust_mph: number;
  rain_in: number;
  snow_in: number;
  riskScore: number;
  riskLevel: RiskLevel;
  spcCategory?: 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';
  eroCategory?: 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';
}

export interface TopCity {
  id: string;
  name: string;
  state: string;
  score: number;
  level: RiskLevel;
  primaryHazard?: string;
}

export interface RegionHazardMetrics {
  // Snow metrics
  snow_p90: number;
  snow_max: number;
  snow_coverage: number;    // % cities >= 1"
  snow_trace_coverage: number;  // % cities >= 0.1"

  // Rain metrics
  rain_p90: number;
  rain_max: number;
  rain_coverage: number;    // % cities >= 0.25"
  rain_heavy_coverage: number;  // % cities >= 1"

  // Wind metrics
  wind_gust_p90: number;
  wind_gust_max: number;
  wind_coverage: number;    // % cities >= 30 mph
  wind_high_coverage: number;   // % cities >= 45 mph

  // Temperature metrics
  temp_min_p10: number;
  temp_max_p90: number;
  cold_coverage: number;    // % cities <= 20°F
  extreme_cold_coverage: number;  // % cities <= 0°F
  heat_coverage: number;    // % cities >= 95°F
  extreme_heat_coverage: number;  // % cities >= 100°F

  // Overlay metrics
  spc_coverage: number;     // % cities in SPC risk
  spc_max?: 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';
  ero_coverage: number;     // % cities in ERO risk
  ero_max?: 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';
}

export interface RegionRiskExplain {
  summary_text: string;
  top_drivers: RiskDriver[];
  breakdown: RiskBreakdownItem[];
  hazard_class: 'winter' | 'rain-flood' | 'severe' | 'wind-temp' | 'quiet';
}

export interface RegionDayMetrics {
  regionId: RegionId;
  dayIndex: number;  // 1-7
  date: string;

  // Temperature percentiles
  temp_min_p10: number;
  temp_max_p90: number;
  temp_min_avg: number;
  temp_max_avg: number;

  // Wind
  wind_gust_p90: number;
  wind_gust_max: number;

  // Rain
  rain_p75: number;
  rain_p90: number;
  rain_max: number;

  // Snow
  snow_p75: number;
  snow_p90: number;
  snow_max: number;

  // Coverage fractions (0.0-1.0)
  rain_cov: number;
  snow_cov: number;
  windy_cov: number;

  // Overlay info
  spc_max?: 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';
  ero_max?: 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';

  // Aggregated risk (blended, not max)
  risk_avg: number;
  risk_max: number;
  risk_p75: number;
  risk_blended: number;   // The actual region score
  risk_level: RiskLevel;

  // Explainability
  explain: RegionRiskExplain;

  // Hazard metrics
  hazards: RegionHazardMetrics;

  // Top impacted cities
  topCities: TopCity[];

  // City count
  cityCount: number;
}

// ============================================================================
// Helper functions
// ============================================================================

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  if (arr.length === 1) return arr[0];

  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower];

  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

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
// Region hazard scoring factors (12+ factors)
// ============================================================================

interface RegionFactor {
  category: string;
  points: number;
  observed: string;
  notes: string;
}

function scoreRegionSnowIntensity(p90: number, max: number): RegionFactor {
  let points = 0;
  let notes = 'None';

  if (p90 >= 6) {
    points = 3.5;
    notes = 'Widespread heavy snow';
  } else if (p90 >= 4) {
    points = 2.8;
    notes = 'Significant snow p90';
  } else if (p90 >= 2) {
    points = 2.0;
    notes = 'Moderate snow p90';
  } else if (p90 >= 1) {
    points = 1.2;
    notes = 'Light-moderate snow';
  } else if (p90 >= 0.5) {
    points = 0.6;
    notes = 'Light snow';
  } else if (max >= 0.5) {
    points = 0.3;
    notes = 'Isolated snow';
  }

  return {
    category: 'Snow Intensity (p90)',
    points: Math.min(3.5, points),
    observed: `p90: ${p90.toFixed(1)}", max: ${max.toFixed(1)}"`,
    notes,
  };
}

function scoreRegionSnowCoverage(coverage: number, traceCoverage: number): RegionFactor {
  let points = 0;
  let notes = 'Minimal';

  if (coverage >= 0.7) {
    points = 1.0;
    notes = 'Widespread (70%+ >= 1")';
  } else if (coverage >= 0.5) {
    points = 0.7;
    notes = 'Broad coverage (50%+)';
  } else if (coverage >= 0.3) {
    points = 0.4;
    notes = 'Moderate coverage';
  } else if (coverage >= 0.1) {
    points = 0.2;
    notes = 'Scattered snow';
  } else if (traceCoverage >= 0.3) {
    points = 0.1;
    notes = 'Trace snow areas';
  }

  return {
    category: 'Snow Coverage',
    points,
    observed: `${Math.round(coverage * 100)}% >= 1"`,
    notes,
  };
}

function scoreRegionRainIntensity(p90: number, max: number): RegionFactor {
  let points = 0;
  let notes = 'None';

  if (p90 >= 2) {
    points = 2.5;
    notes = 'Widespread heavy rain';
  } else if (p90 >= 1) {
    points = 1.8;
    notes = 'Significant rain p90';
  } else if (p90 >= 0.5) {
    points = 1.0;
    notes = 'Moderate rain';
  } else if (p90 >= 0.25) {
    points = 0.5;
    notes = 'Light-moderate rain';
  } else if (max >= 0.5) {
    points = 0.3;
    notes = 'Isolated heavier rain';
  }

  return {
    category: 'Rain Intensity (p90)',
    points: Math.min(2.5, points),
    observed: `p90: ${p90.toFixed(2)}", max: ${max.toFixed(2)}"`,
    notes,
  };
}

function scoreRegionRainCoverage(coverage: number, heavyCoverage: number): RegionFactor {
  let points = 0;
  let notes = 'Minimal';

  if (heavyCoverage >= 0.5) {
    points = 0.8;
    notes = 'Widespread heavy rain';
  } else if (coverage >= 0.7) {
    points = 0.6;
    notes = 'Broad rain coverage';
  } else if (coverage >= 0.5) {
    points = 0.4;
    notes = 'Moderate coverage';
  } else if (coverage >= 0.25) {
    points = 0.2;
    notes = 'Scattered rain';
  }

  return {
    category: 'Rain Coverage',
    points,
    observed: `${Math.round(coverage * 100)}% >= 0.25"`,
    notes,
  };
}

function scoreRegionWindIntensity(p90: number, max: number): RegionFactor {
  let points = 0;
  let notes = 'Light';

  if (p90 >= 50) {
    points = 2.5;
    notes = 'Widespread high winds';
  } else if (p90 >= 40) {
    points = 1.8;
    notes = 'Significant wind p90';
  } else if (p90 >= 35) {
    points = 1.2;
    notes = 'Elevated wind p90';
  } else if (p90 >= 30) {
    points = 0.7;
    notes = 'Moderate winds';
  } else if (max >= 40) {
    points = 0.4;
    notes = 'Isolated strong gusts';
  } else if (max >= 30) {
    points = 0.2;
    notes = 'Occasional gusts';
  }

  return {
    category: 'Wind Gust Intensity (p90)',
    points: Math.min(2.5, points),
    observed: `p90: ${Math.round(p90)} mph, max: ${Math.round(max)} mph`,
    notes,
  };
}

function scoreRegionWindCoverage(coverage: number, highCoverage: number): RegionFactor {
  let points = 0;
  let notes = 'Minimal';

  if (highCoverage >= 0.4) {
    points = 0.6;
    notes = 'Widespread high winds';
  } else if (coverage >= 0.6) {
    points = 0.5;
    notes = 'Broad windy conditions';
  } else if (coverage >= 0.4) {
    points = 0.3;
    notes = 'Moderate wind coverage';
  } else if (coverage >= 0.2) {
    points = 0.15;
    notes = 'Scattered winds';
  }

  return {
    category: 'Wind Coverage',
    points,
    observed: `${Math.round(coverage * 100)}% >= 30 mph`,
    notes,
  };
}

function scoreRegionColdIntensity(p10: number): RegionFactor {
  let points = 0;
  let notes = 'Mild';

  if (p10 <= -10) {
    points = 1.5;
    notes = 'Extreme cold (p10 <= -10°F)';
  } else if (p10 <= 0) {
    points = 1.0;
    notes = 'Dangerous cold';
  } else if (p10 <= 10) {
    points = 0.6;
    notes = 'Very cold';
  } else if (p10 <= 20) {
    points = 0.3;
    notes = 'Cold';
  } else if (p10 <= 28) {
    points = 0.1;
    notes = 'Below freezing';
  }

  return {
    category: 'Cold Intensity (p10)',
    points: Math.min(1.5, points),
    observed: `p10: ${Math.round(p10)}°F`,
    notes,
  };
}

function scoreRegionColdCoverage(coverage: number, extremeCoverage: number): RegionFactor {
  let points = 0;
  let notes = 'Minimal';

  if (extremeCoverage >= 0.3) {
    points = 0.6;
    notes = 'Widespread extreme cold';
  } else if (coverage >= 0.5) {
    points = 0.4;
    notes = 'Broad cold coverage';
  } else if (coverage >= 0.3) {
    points = 0.2;
    notes = 'Moderate cold coverage';
  }

  return {
    category: 'Cold Coverage',
    points,
    observed: `${Math.round(coverage * 100)}% <= 20°F`,
    notes,
  };
}

function scoreRegionHeatIntensity(p90: number): RegionFactor {
  let points = 0;
  let notes = 'Normal';

  if (p90 >= 105) {
    points = 2.0;
    notes = 'Extreme heat (p90 >= 105°F)';
  } else if (p90 >= 100) {
    points = 1.4;
    notes = 'Excessive heat';
  } else if (p90 >= 95) {
    points = 0.8;
    notes = 'Very hot';
  } else if (p90 >= 90) {
    points = 0.3;
    notes = 'Hot';
  }

  return {
    category: 'Heat Intensity (p90)',
    points: Math.min(2.0, points),
    observed: `p90: ${Math.round(p90)}°F`,
    notes,
  };
}

function scoreRegionWinterTravel(
  snowCov: number,
  windCov: number,
  coldCov: number,
  snowP90: number,
  windP90: number
): RegionFactor {
  // Need snow for winter travel
  if (snowP90 < 0.5) {
    return {
      category: 'Winter Travel Index',
      points: 0,
      observed: 'N/A',
      notes: 'No significant snow',
    };
  }

  let points = 0;
  const factors: string[] = [];

  if (snowP90 >= 2 && snowCov >= 0.4) {
    points += 0.5;
    factors.push('snow');
  } else if (snowP90 >= 1) {
    points += 0.25;
    factors.push('snow');
  }

  if (windP90 >= 30 && snowP90 >= 1) {
    points += 0.4;
    factors.push('wind');
  }

  if (coldCov >= 0.3 && snowP90 >= 1) {
    points += 0.3;
    factors.push('cold');
  }

  if (factors.length >= 3) {
    points += 0.2;
  }

  return {
    category: 'Winter Travel Index',
    points: Math.min(1.2, points),
    observed: `Snow cov: ${Math.round(snowCov * 100)}%, Wind cov: ${Math.round(windCov * 100)}%`,
    notes: factors.length > 0 ? factors.join(' + ') : 'Minor',
  };
}

function scoreRegionMultiHazard(factors: RegionFactor[]): RegionFactor {
  const significant = factors.filter(f =>
    f.points >= 0.5 &&
    !['Multi-Hazard Synergy', 'Winter Travel Index'].includes(f.category)
  );

  let points = 0;
  let notes = 'Single hazard';

  if (significant.length >= 4) {
    points = 0.5;
    notes = 'Multiple significant hazards';
  } else if (significant.length >= 3) {
    points = 0.35;
    notes = '3 hazards combining';
  } else if (significant.length >= 2) {
    points = 0.2;
    notes = '2 hazards present';
  }

  return {
    category: 'Multi-Hazard Synergy',
    points,
    observed: `${significant.length} active`,
    notes,
  };
}

function scoreRegionSPCOverlay(
  spcMax?: string,
  spcCoverage?: number,
  dayIndex?: number
): RegionFactor {
  if (!spcMax || (dayIndex && dayIndex > 3)) {
    return { category: 'SPC Outlook', points: 0, observed: 'None', notes: 'None' };
  }

  const basePoints: Record<string, number> = {
    'MRGL': 1.0, 'SLGT': 2.0, 'ENH': 3.5, 'MDT': 5.0, 'HIGH': 7.0
  };

  let points = basePoints[spcMax] || 0;

  // Coverage boost
  if (spcCoverage && spcCoverage >= 0.3) {
    points *= 1.2;
  }

  return {
    category: 'SPC Outlook',
    points: Math.min(8.0, points),
    observed: `${spcMax} (${Math.round((spcCoverage || 0) * 100)}% coverage)`,
    notes: `${spcMax} severe risk`,
  };
}

function scoreRegionEROOverlay(
  eroMax?: string,
  eroCoverage?: number,
  dayIndex?: number
): RegionFactor {
  if (!eroMax || (dayIndex && dayIndex > 3)) {
    return { category: 'WPC ERO', points: 0, observed: 'None', notes: 'None' };
  }

  const basePoints: Record<string, number> = {
    'MRGL': 0.3, 'SLGT': 1.0, 'MDT': 1.8, 'HIGH': 3.5
  };

  let points = basePoints[eroMax] || 0;

  if (eroCoverage && eroCoverage >= 0.3) {
    points *= 1.15;
  }

  return {
    category: 'WPC ERO',
    points: Math.min(4.5, points),
    observed: `${eroMax} (${Math.round((eroCoverage || 0) * 100)}% coverage)`,
    notes: `${eroMax} excessive rainfall`,
  };
}

// ============================================================================
// Main aggregation function
// ============================================================================

export function computeRegionDayMetrics(
  regionId: RegionId,
  dayIndex: number,
  date: string,
  cityData: CityDayData[]
): RegionDayMetrics {
  const n = cityData.length;

  if (n === 0) {
    return createEmptyMetrics(regionId, dayIndex, date);
  }

  // Extract arrays
  const tmins = cityData.map(c => c.tmin_f);
  const tmaxs = cityData.map(c => c.tmax_f);
  const gusts = cityData.map(c => c.wind_gust_mph);
  const rains = cityData.map(c => c.rain_in);
  const snows = cityData.map(c => c.snow_in);
  const risks = cityData.map(c => c.riskScore);

  // ===== COMPUTE HAZARD METRICS =====
  const hazards: RegionHazardMetrics = {
    snow_p90: percentile(snows, 90),
    snow_max: Math.max(...snows),
    snow_coverage: cityData.filter(c => c.snow_in >= 1.0).length / n,
    snow_trace_coverage: cityData.filter(c => c.snow_in >= 0.1).length / n,

    rain_p90: percentile(rains, 90),
    rain_max: Math.max(...rains),
    rain_coverage: cityData.filter(c => c.rain_in >= 0.25).length / n,
    rain_heavy_coverage: cityData.filter(c => c.rain_in >= 1.0).length / n,

    wind_gust_p90: percentile(gusts, 90),
    wind_gust_max: Math.max(...gusts),
    wind_coverage: cityData.filter(c => c.wind_gust_mph >= 30).length / n,
    wind_high_coverage: cityData.filter(c => c.wind_gust_mph >= 45).length / n,

    temp_min_p10: percentile(tmins, 10),
    temp_max_p90: percentile(tmaxs, 90),
    cold_coverage: cityData.filter(c => c.tmin_f <= 20).length / n,
    extreme_cold_coverage: cityData.filter(c => c.tmin_f <= 0).length / n,
    heat_coverage: cityData.filter(c => c.tmax_f >= 95).length / n,
    extreme_heat_coverage: cityData.filter(c => c.tmax_f >= 100).length / n,

    spc_coverage: cityData.filter(c => c.spcCategory).length / n,
    spc_max: undefined,
    ero_coverage: cityData.filter(c => c.eroCategory).length / n,
    ero_max: undefined,
  };

  // Find max SPC/ERO
  for (const city of cityData) {
    if (city.spcCategory && spcOrder(city.spcCategory) > spcOrder(hazards.spc_max)) {
      hazards.spc_max = city.spcCategory;
    }
    if (city.eroCategory && eroOrder(city.eroCategory) > eroOrder(hazards.ero_max)) {
      hazards.ero_max = city.eroCategory;
    }
  }

  // ===== COMPUTE REGION RISK FACTORS (12+) =====
  const factors: RegionFactor[] = [];

  factors.push(scoreRegionSnowIntensity(hazards.snow_p90, hazards.snow_max));
  factors.push(scoreRegionSnowCoverage(hazards.snow_coverage, hazards.snow_trace_coverage));
  factors.push(scoreRegionRainIntensity(hazards.rain_p90, hazards.rain_max));
  factors.push(scoreRegionRainCoverage(hazards.rain_coverage, hazards.rain_heavy_coverage));
  factors.push(scoreRegionWindIntensity(hazards.wind_gust_p90, hazards.wind_gust_max));
  factors.push(scoreRegionWindCoverage(hazards.wind_coverage, hazards.wind_high_coverage));
  factors.push(scoreRegionColdIntensity(hazards.temp_min_p10));
  factors.push(scoreRegionColdCoverage(hazards.cold_coverage, hazards.extreme_cold_coverage));
  factors.push(scoreRegionHeatIntensity(hazards.temp_max_p90));
  factors.push(scoreRegionWinterTravel(
    hazards.snow_coverage,
    hazards.wind_coverage,
    hazards.cold_coverage,
    hazards.snow_p90,
    hazards.wind_gust_p90
  ));
  factors.push(scoreRegionMultiHazard(factors));
  factors.push(scoreRegionSPCOverlay(hazards.spc_max, hazards.spc_coverage, dayIndex));
  factors.push(scoreRegionEROOverlay(hazards.ero_max, hazards.ero_coverage, dayIndex));

  // ===== COMPUTE BLENDED REGION SCORE =====
  // NOT just max city!
  const risk_avg = risks.reduce((a, b) => a + b, 0) / n;
  const risk_max = Math.max(...risks);
  const risk_p75 = percentile(risks, 75);

  // Blend: baseline from p75, with impact boost from max and coverage boost
  let baseScore = risk_p75;
  const impactBoost = Math.max(0, (risk_max - risk_p75) * 0.25);
  const hazardPoints = factors.reduce((sum, f) => sum + f.points, 0);

  // Weight hazard points vs city risk distribution
  const hazardScore = Math.min(10, hazardPoints);
  let risk_blended = (baseScore * 0.4) + (hazardScore * 0.4) + (impactBoost * 0.2);

  // Day damping for extended forecasts
  const damping: Record<number, number> = { 1: 1.0, 2: 1.0, 3: 1.0, 4: 0.95, 5: 0.9, 6: 0.85, 7: 0.8 };
  const damp = damping[dayIndex] || 1.0;
  if (risk_blended > 1 && damp < 1) {
    risk_blended = 1 + (risk_blended - 1) * damp;
  }

  risk_blended = Math.max(0, Math.min(10, risk_blended));

  // ===== BUILD EXPLAINABILITY =====
  const breakdown: RiskBreakdownItem[] = factors
    .filter(f => f.points > 0)
    .sort((a, b) => b.points - a.points)
    .map(f => ({
      category: f.category,
      contribution: Math.round(f.points * 100) / 100,
      details: `${f.observed} - ${f.notes}`,
    }));

  const topDrivers: RiskDriver[] = factors
    .filter(f => f.points >= 0.3)
    .sort((a, b) => b.points - a.points)
    .slice(0, 4)
    .map(f => ({
      hazard: f.category,
      score: Math.round(f.points * 10) / 10,
      rawValue: 0,
      unit: '',
      description: f.notes,
    }));

  // Determine hazard class
  const snowPoints = factors.find(f => f.category.includes('Snow Intensity'))?.points || 0;
  const rainPoints = factors.find(f => f.category.includes('Rain Intensity'))?.points || 0;
  const spcPoints = factors.find(f => f.category === 'SPC Outlook')?.points || 0;
  const windPoints = factors.find(f => f.category.includes('Wind Gust'))?.points || 0;

  let hazard_class: RegionRiskExplain['hazard_class'] = 'quiet';
  if (spcPoints >= 2) hazard_class = 'severe';
  else if (snowPoints >= 1 || factors.find(f => f.category === 'Winter Travel Index')?.points || 0 >= 0.5) hazard_class = 'winter';
  else if (rainPoints >= 1) hazard_class = 'rain-flood';
  else if (windPoints >= 1 || factors.find(f => f.category.includes('Heat'))?.points || 0 >= 0.5) hazard_class = 'wind-temp';

  const summary_text = generateRegionSummary(factors, hazards, hazard_class, risk_blended, dayIndex);

  const explain: RegionRiskExplain = {
    summary_text,
    top_drivers: topDrivers,
    breakdown,
    hazard_class,
  };

  // ===== TOP CITIES =====
  const sortedByRisk = [...cityData].sort((a, b) => b.riskScore - a.riskScore);
  const topCities: TopCity[] = sortedByRisk.slice(0, 5).map(c => ({
    id: c.cityId,
    name: c.cityName,
    state: c.state,
    score: Math.round(c.riskScore * 10) / 10,
    level: c.riskLevel,
    primaryHazard: determinePrimaryHazard(c),
  }));

  return {
    regionId,
    dayIndex,
    date,
    temp_min_p10: Math.round(hazards.temp_min_p10),
    temp_max_p90: Math.round(hazards.temp_max_p90),
    temp_min_avg: Math.round(tmins.reduce((a, b) => a + b, 0) / n),
    temp_max_avg: Math.round(tmaxs.reduce((a, b) => a + b, 0) / n),
    wind_gust_p90: Math.round(hazards.wind_gust_p90),
    wind_gust_max: Math.round(hazards.wind_gust_max),
    rain_p75: Math.round(percentile(rains, 75) * 100) / 100,
    rain_p90: Math.round(hazards.rain_p90 * 100) / 100,
    rain_max: Math.round(hazards.rain_max * 100) / 100,
    snow_p75: Math.round(percentile(snows, 75) * 10) / 10,
    snow_p90: Math.round(hazards.snow_p90 * 10) / 10,
    snow_max: Math.round(hazards.snow_max * 10) / 10,
    rain_cov: Math.round(hazards.rain_coverage * 100) / 100,
    snow_cov: Math.round(hazards.snow_coverage * 100) / 100,
    windy_cov: Math.round(hazards.wind_coverage * 100) / 100,
    spc_max: hazards.spc_max,
    ero_max: hazards.ero_max,
    risk_avg: Math.round(risk_avg * 100) / 100,
    risk_max: Math.round(risk_max * 100) / 100,
    risk_p75: Math.round(risk_p75 * 100) / 100,
    risk_blended: Math.round(risk_blended * 100) / 100,
    risk_level: scoreToLevel(risk_blended),
    explain,
    hazards,
    topCities,
    cityCount: n,
  };
}

function createEmptyMetrics(regionId: RegionId, dayIndex: number, date: string): RegionDayMetrics {
  return {
    regionId,
    dayIndex,
    date,
    temp_min_p10: 32,
    temp_max_p90: 50,
    temp_min_avg: 32,
    temp_max_avg: 50,
    wind_gust_p90: 0,
    wind_gust_max: 0,
    rain_p75: 0,
    rain_p90: 0,
    rain_max: 0,
    snow_p75: 0,
    snow_p90: 0,
    snow_max: 0,
    rain_cov: 0,
    snow_cov: 0,
    windy_cov: 0,
    risk_avg: 1,
    risk_max: 1,
    risk_p75: 1,
    risk_blended: 1,
    risk_level: 'very-quiet',
    explain: {
      summary_text: 'No data available.',
      top_drivers: [],
      breakdown: [],
      hazard_class: 'quiet',
    },
    hazards: {
      snow_p90: 0, snow_max: 0, snow_coverage: 0, snow_trace_coverage: 0,
      rain_p90: 0, rain_max: 0, rain_coverage: 0, rain_heavy_coverage: 0,
      wind_gust_p90: 0, wind_gust_max: 0, wind_coverage: 0, wind_high_coverage: 0,
      temp_min_p10: 32, temp_max_p90: 50,
      cold_coverage: 0, extreme_cold_coverage: 0,
      heat_coverage: 0, extreme_heat_coverage: 0,
      spc_coverage: 0, ero_coverage: 0,
    },
    topCities: [],
    cityCount: 0,
  };
}

function generateRegionSummary(
  factors: RegionFactor[],
  hazards: RegionHazardMetrics,
  hazardClass: string,
  score: number,
  dayIndex: number
): string {
  if (score < 1.5) {
    return 'No significant weather hazards expected across the region.';
  }

  const sentences: string[] = [];
  const significant = factors.filter(f => f.points >= 0.5);

  if (hazardClass === 'winter') {
    if (hazards.snow_p90 >= 2) {
      sentences.push(`Significant snow impacts with p90 accumulations near ${hazards.snow_p90.toFixed(1)}" affecting ${Math.round(hazards.snow_coverage * 100)}% of the region.`);
    } else {
      sentences.push(`Winter weather impacts expected across the region.`);
    }
  } else if (hazardClass === 'rain-flood') {
    sentences.push(`Rain impacts with p90 totals near ${hazards.rain_p90.toFixed(2)}" affecting ${Math.round(hazards.rain_coverage * 100)}% of cities.`);
  } else if (hazardClass === 'severe') {
    sentences.push(`Elevated severe weather risk with ${hazards.spc_max} outlook covering ${Math.round(hazards.spc_coverage * 100)}% of the region.`);
  } else if (hazardClass === 'wind-temp') {
    if (hazards.wind_gust_p90 >= 30) {
      sentences.push(`Windy conditions with p90 gusts near ${Math.round(hazards.wind_gust_p90)} mph.`);
    } else if (hazards.temp_max_p90 >= 95) {
      sentences.push(`Hot conditions with p90 highs near ${Math.round(hazards.temp_max_p90)}°F.`);
    }
  }

  // Add secondary hazards
  const secondaryHazards = significant.filter(f =>
    !f.category.includes(hazardClass === 'winter' ? 'Snow' : hazardClass === 'rain-flood' ? 'Rain' : 'Wind')
  );

  if (secondaryHazards.length > 0) {
    const names = secondaryHazards.slice(0, 2).map(f => f.category.split(' ')[0]);
    sentences.push(`${names.join(' and ')} add to regional impacts.`);
  }

  if (dayIndex >= 6) {
    sentences.push('Extended range forecast confidence is lower.');
  }

  return sentences.join(' ');
}

function determinePrimaryHazard(city: CityDayData): string {
  const hazards: { name: string; severity: number }[] = [];

  if (city.snow_in >= 4) hazards.push({ name: 'heavy snow', severity: city.snow_in * 2 });
  else if (city.snow_in >= 1) hazards.push({ name: 'snow', severity: city.snow_in * 1.5 });

  if (city.rain_in >= 1) hazards.push({ name: 'heavy rain', severity: city.rain_in * 2 });
  else if (city.rain_in >= 0.25) hazards.push({ name: 'rain', severity: city.rain_in * 1.5 });

  if (city.wind_gust_mph >= 50) hazards.push({ name: 'high winds', severity: city.wind_gust_mph / 10 });
  else if (city.wind_gust_mph >= 30) hazards.push({ name: 'wind', severity: city.wind_gust_mph / 15 });

  if (city.tmin_f <= 0) hazards.push({ name: 'extreme cold', severity: 3 });
  else if (city.tmin_f <= 20) hazards.push({ name: 'cold', severity: 1.5 });

  if (city.tmax_f >= 100) hazards.push({ name: 'extreme heat', severity: 3 });
  else if (city.tmax_f >= 95) hazards.push({ name: 'heat', severity: 2 });

  if (city.spcCategory) hazards.push({ name: 'severe storms', severity: spcOrder(city.spcCategory) * 1.5 });
  if (city.eroCategory) hazards.push({ name: 'flooding', severity: eroOrder(city.eroCategory) });

  if (hazards.length === 0) return 'quiet';

  hazards.sort((a, b) => b.severity - a.severity);
  return hazards[0].name;
}

export function extractCityDayData(
  city: { cityId: string; name: string; state: string; lat: number; lon: number; regionId: RegionId; dailySummary?: Array<{ tmax: number; tmin: number; wind_gust_max: number; rain_total: number; snow_total: number }>; dailyRisks?: Array<{ score_display: number; level: RiskLevel }> },
  dayIndex: number,
  spcCategory?: 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH',
  eroCategory?: 'MRGL' | 'SLGT' | 'MDT' | 'HIGH'
): CityDayData | null {
  const i = dayIndex - 1;
  if (!city.dailySummary?.[i] || !city.dailyRisks?.[i]) return null;

  const daySummary = city.dailySummary[i];
  const dayRisk = city.dailyRisks[i];

  return {
    cityId: city.cityId,
    cityName: city.name,
    state: city.state,
    lat: city.lat,
    lon: city.lon,
    tmax_f: daySummary.tmax,
    tmin_f: daySummary.tmin,
    wind_gust_mph: daySummary.wind_gust_max,
    rain_in: daySummary.rain_total,
    snow_in: daySummary.snow_total,
    riskScore: dayRisk.score_display,
    riskLevel: dayRisk.level,
    spcCategory: dayIndex <= 3 ? spcCategory : undefined,
    eroCategory: dayIndex <= 3 ? eroCategory : undefined,
  };
}
