/**
 * Canonical Region Risk Scoring Pipeline
 *
 * Region score is computed from:
 * - Distribution of city scores (not just max)
 * - Region weather metrics + coverage counts
 * - Overlay presence counts
 *
 * This is THE SINGLE SOURCE OF TRUTH for region risk calculation.
 * Score and explainer are derived from the same factor list.
 *
 * Region factors include:
 * - City Risk Distribution (p75)
 * - Max City Risk (capped)
 * - Snow Hazard (p90 + coverage)
 * - Rain/Flood Hazard (p90 + coverage + rate)
 * - Wind Hazard (p90 + coverage)
 * - Cold Hazard (p10 + coverage)
 * - Winter Travel Hazard
 * - SPC Overlay (affected cities + category) - Days 1-3
 * - WPC ERO Overlay (affected cities + category) - Days 1-3
 * - WPC WSSI Overlay (affected cities + category) - Days 1-3
 * - Multi-hazard synergy
 */

import {
  RiskFactor,
  RiskScoreResult,
  RiskLevel,
  RiskFactorCategory,
  scoreToLevel,
  deriveTopDrivers,
  round,
  clamp,
  percentile,
  applyDayDamping,
  SPC_POINTS,
  ERO_POINTS,
  WSSI_POINTS,
  SPC_ORDER,
  ERO_ORDER,
  WSSI_ORDER,
  SPC_DAY48_POINTS,
  SPC_DAY48_ORDER,
  SNOW_REGION_MULTIPLIERS,
  ICE_REGION_MULTIPLIERS,
} from './riskTypes';

// ============================================================================
// Input Types
// ============================================================================

export interface CityRiskInput {
  cityId: string;
  cityName: string;
  state: string;
  score: number;
  level: RiskLevel;
  // Weather metrics for the city/day
  tmax_f: number;
  tmin_f: number;
  wind_gust_mph: number;
  rain_in: number;
  snow_in: number;
  // NBM ice accumulation (FRAM) in inches
  ice_in?: number;
  // Overlay presence (Days 1-3)
  spcCategory?: 'TSTM' | 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';
  eroCategory?: 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';
  wssiCategory?: 'WINTER WEATHER AREA' | 'MINOR' | 'MODERATE' | 'MAJOR' | 'EXTREME';
  // Overlay presence (Days 4-8)
  spcDay48Category?: 'SLGT' | 'ENH';
  spcDay48Dn?: number | null;
}

export interface RegionWeatherMetrics {
  // Computed from city data
  snow_p90: number;
  snow_max: number;
  snow_coverage: number;      // fraction of cities >= 1"
  snow_trace_coverage: number; // fraction of cities >= 0.1"
  rain_p90: number;
  rain_max: number;
  rain_coverage: number;      // fraction of cities >= 0.25"
  rain_heavy_coverage: number; // fraction of cities >= 1"
  // NBM ice accumulation (FRAM)
  ice_p90: number;
  ice_max: number;
  ice_coverage: number;       // fraction of cities >= 0.1" ice
  ice_heavy_coverage: number; // fraction of cities >= 0.25" ice
  wind_gust_p90: number;
  wind_gust_max: number;
  wind_coverage: number;      // fraction of cities >= 30 mph
  wind_high_coverage: number; // fraction of cities >= 45 mph
  temp_min_p10: number;
  temp_max_p90: number;
  cold_coverage: number;      // fraction of cities <= 20°F
  extreme_cold_coverage: number; // fraction of cities <= 0°F
  heat_coverage: number;      // fraction of cities >= 95°F
  extreme_heat_coverage: number; // fraction of cities >= 100°F
  // Overlay coverage (Days 1-3)
  spc_coverage: number;       // fraction of cities in SPC risk
  spc_max?: 'TSTM' | 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';
  spc_max_city?: string;      // City that caused the max SPC category
  spc_avg_points?: number;    // Average SPC points across cities with SPC risk
  spc_city_breakdown?: Array<{ cityId: string; cityName: string; category: string }>; // All cities with SPC
  ero_coverage: number;       // fraction of cities in ERO risk
  ero_max?: 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';
  ero_max_city?: string;      // City that caused the max ERO category
  wssi_coverage: number;      // fraction of cities in WSSI risk
  wssi_max?: 'WINTER WEATHER AREA' | 'MINOR' | 'MODERATE' | 'MAJOR' | 'EXTREME';
  wssi_max_city?: string;     // City that caused the max WSSI category
  wssi_avg_points?: number;   // Average WSSI points across cities with WSSI risk
  wssi_city_breakdown?: Array<{ cityId: string; cityName: string; category: string }>; // All cities with WSSI
  // SPC Day 4-8 overlay coverage
  spc_day48_coverage: number;  // fraction of cities in SPC Day 4-8 risk
  spc_day48_max?: 'SLGT' | 'ENH';
  spc_day48_max_dn?: number | null;
  spc_day48_max_city?: string;
  spc_day48_avg_points?: number;
  spc_day48_city_breakdown?: Array<{ cityId: string; cityName: string; category: string; dn: number | null }>;
  // City count
  cityCount: number;
}

// ============================================================================
// Compute Region Metrics from City Data
// ============================================================================

export function computeRegionMetrics(cities: CityRiskInput[]): RegionWeatherMetrics {
  const n = cities.length;
  if (n === 0) {
    return {
      snow_p90: 0, snow_max: 0, snow_coverage: 0, snow_trace_coverage: 0,
      rain_p90: 0, rain_max: 0, rain_coverage: 0, rain_heavy_coverage: 0,
      ice_p90: 0, ice_max: 0, ice_coverage: 0, ice_heavy_coverage: 0,
      wind_gust_p90: 0, wind_gust_max: 0, wind_coverage: 0, wind_high_coverage: 0,
      temp_min_p10: 32, temp_max_p90: 50,
      cold_coverage: 0, extreme_cold_coverage: 0,
      heat_coverage: 0, extreme_heat_coverage: 0,
      spc_coverage: 0, ero_coverage: 0, wssi_coverage: 0,
      spc_day48_coverage: 0,
      cityCount: 0,
    };
  }

  const snows = cities.map(c => c.snow_in);
  const rains = cities.map(c => c.rain_in);
  const ices = cities.map(c => c.ice_in || 0);
  const gusts = cities.map(c => c.wind_gust_mph);
  const tmins = cities.map(c => c.tmin_f);
  const tmaxs = cities.map(c => c.tmax_f);

  // Find max SPC/ERO/WSSI with debug info (Days 1-3)
  let spcMax: RegionWeatherMetrics['spc_max'] = undefined;
  let spcMaxCity: string | undefined = undefined;
  let eroMax: RegionWeatherMetrics['ero_max'] = undefined;
  let eroMaxCity: string | undefined = undefined;
  let wssiMax: RegionWeatherMetrics['wssi_max'] = undefined;
  let wssiMaxCity: string | undefined = undefined;
  const spcCityBreakdown: Array<{ cityId: string; cityName: string; category: string }> = [];
  const wssiCityBreakdown: Array<{ cityId: string; cityName: string; category: string }> = [];
  let spcPointsSum = 0;
  let spcCityCount = 0;
  let wssiPointsSum = 0;
  let wssiCityCount = 0;

  // Find max SPC Day 4-8 with debug info
  let spcDay48Max: RegionWeatherMetrics['spc_day48_max'] = undefined;
  let spcDay48MaxDn: number | null = null;
  let spcDay48MaxCity: string | undefined = undefined;
  const spcDay48CityBreakdown: Array<{ cityId: string; cityName: string; category: string; dn: number | null }> = [];
  let spcDay48PointsSum = 0;
  let spcDay48CityCount = 0;

  for (const city of cities) {
    // Day 1-3 SPC
    if (city.spcCategory) {
      spcCityBreakdown.push({
        cityId: city.cityId,
        cityName: `${city.cityName}, ${city.state}`,
        category: city.spcCategory,
      });
      spcPointsSum += SPC_POINTS[city.spcCategory] || 0;
      spcCityCount++;

      if (!spcMax || SPC_ORDER[city.spcCategory] > SPC_ORDER[spcMax]) {
        spcMax = city.spcCategory;
        spcMaxCity = `${city.cityName}, ${city.state}`;
      }
    }
    if (city.eroCategory && (!eroMax || ERO_ORDER[city.eroCategory] > ERO_ORDER[eroMax])) {
      eroMax = city.eroCategory;
      eroMaxCity = `${city.cityName}, ${city.state}`;
    }
    if (city.wssiCategory) {
      wssiCityBreakdown.push({
        cityId: city.cityId,
        cityName: `${city.cityName}, ${city.state}`,
        category: city.wssiCategory,
      });
      wssiPointsSum += WSSI_POINTS[city.wssiCategory] || 0;
      wssiCityCount++;

      if (!wssiMax || WSSI_ORDER[city.wssiCategory] > WSSI_ORDER[wssiMax]) {
        wssiMax = city.wssiCategory;
        wssiMaxCity = `${city.cityName}, ${city.state}`;
      }
    }

    // Day 4-8 SPC
    if (city.spcDay48Category) {
      spcDay48CityBreakdown.push({
        cityId: city.cityId,
        cityName: `${city.cityName}, ${city.state}`,
        category: city.spcDay48Category,
        dn: city.spcDay48Dn ?? null,
      });
      spcDay48PointsSum += SPC_DAY48_POINTS[city.spcDay48Category] || 0;
      spcDay48CityCount++;

      if (!spcDay48Max || SPC_DAY48_ORDER[city.spcDay48Category] > SPC_DAY48_ORDER[spcDay48Max]) {
        spcDay48Max = city.spcDay48Category as 'SLGT' | 'ENH';
        spcDay48MaxDn = city.spcDay48Dn ?? null;
        spcDay48MaxCity = `${city.cityName}, ${city.state}`;
      }
    }
  }

  const spcAvgPoints = spcCityCount > 0 ? spcPointsSum / spcCityCount : 0;
  const wssiAvgPoints = wssiCityCount > 0 ? wssiPointsSum / wssiCityCount : 0;
  const spcDay48AvgPoints = spcDay48CityCount > 0 ? spcDay48PointsSum / spcDay48CityCount : 0;

  return {
    snow_p90: percentile(snows, 90),
    snow_max: Math.max(...snows),
    snow_coverage: cities.filter(c => c.snow_in >= 1.0).length / n,
    snow_trace_coverage: cities.filter(c => c.snow_in >= 0.1).length / n,
    rain_p90: percentile(rains, 90),
    rain_max: Math.max(...rains),
    rain_coverage: cities.filter(c => c.rain_in >= 0.25).length / n,
    rain_heavy_coverage: cities.filter(c => c.rain_in >= 1.0).length / n,
    // Ice accumulation (NBM FRAM)
    ice_p90: percentile(ices, 90),
    ice_max: Math.max(...ices),
    ice_coverage: cities.filter(c => (c.ice_in || 0) >= 0.1).length / n,
    ice_heavy_coverage: cities.filter(c => (c.ice_in || 0) >= 0.25).length / n,
    wind_gust_p90: percentile(gusts, 90),
    wind_gust_max: Math.max(...gusts),
    wind_coverage: cities.filter(c => c.wind_gust_mph >= 30).length / n,
    wind_high_coverage: cities.filter(c => c.wind_gust_mph >= 45).length / n,
    temp_min_p10: percentile(tmins, 10),
    temp_max_p90: percentile(tmaxs, 90),
    cold_coverage: cities.filter(c => c.tmin_f <= 20).length / n,
    extreme_cold_coverage: cities.filter(c => c.tmin_f <= 0).length / n,
    heat_coverage: cities.filter(c => c.tmax_f >= 95).length / n,
    extreme_heat_coverage: cities.filter(c => c.tmax_f >= 100).length / n,
    spc_coverage: cities.filter(c => c.spcCategory).length / n,
    spc_max: spcMax,
    spc_max_city: spcMaxCity,
    spc_avg_points: round(spcAvgPoints, 2),
    spc_city_breakdown: spcCityBreakdown,
    ero_coverage: cities.filter(c => c.eroCategory).length / n,
    ero_max: eroMax,
    ero_max_city: eroMaxCity,
    wssi_coverage: cities.filter(c => c.wssiCategory).length / n,
    wssi_max: wssiMax,
    wssi_max_city: wssiMaxCity,
    wssi_avg_points: round(wssiAvgPoints, 2),
    wssi_city_breakdown: wssiCityBreakdown,
    // SPC Day 4-8
    spc_day48_coverage: cities.filter(c => c.spcDay48Category).length / n,
    spc_day48_max: spcDay48Max,
    spc_day48_max_dn: spcDay48MaxDn,
    spc_day48_max_city: spcDay48MaxCity,
    spc_day48_avg_points: round(spcDay48AvgPoints, 2),
    spc_day48_city_breakdown: spcDay48CityBreakdown,
    cityCount: n,
  };
}

// ============================================================================
// Factor Functions (12+ factors)
// ============================================================================

/**
 * Factor: City Risk Distribution (p75)
 * The foundation of region scoring - what are cities experiencing
 */
function factorCityRiskDistribution(
  cityScores: number[],
  dayIndex: number
): RiskFactor {
  if (cityScores.length === 0) {
    return {
      id: 'city_risk_p75',
      label: 'City Risk Distribution (p75)',
      category: 'distribution',
      observed: 'N/A',
      points: 0,
      notes: 'No city data',
      dayIndex,
      scope: 'region',
    };
  }

  const p75 = percentile(cityScores, 75);
  // p75 contributes directly - scaled by 0.4 as base
  const points = p75 * 0.4;

  return {
    id: 'city_risk_p75',
    label: 'City Risk Distribution (p75)',
    category: 'distribution',
    observed: `p75: ${round(p75, 1)}/10`,
    points: round(points, 2),
    notes: p75 >= 5 ? 'Elevated regional baseline' : p75 >= 3 ? 'Moderate regional baseline' : 'Low regional baseline',
    dayIndex,
    scope: 'region',
    meta: { p75, cityCount: cityScores.length },
  };
}

/**
 * Factor: Max City Risk (heavily capped impact boost)
 * High-impact cities should NOT significantly affect regional score
 * Reduced from 0.2 multiplier / 1.5 cap to 0.08 multiplier / 0.5 cap
 */
function factorMaxCityRisk(
  cityScores: number[],
  dayIndex: number
): RiskFactor {
  if (cityScores.length === 0) {
    return {
      id: 'city_risk_max',
      label: 'Max City Risk',
      category: 'distribution',
      observed: 'N/A',
      points: 0,
      notes: 'No city data',
      dayIndex,
      scope: 'region',
    };
  }

  const max = Math.max(...cityScores);
  const p75 = percentile(cityScores, 75);
  // Heavily reduced impact boost from outliers - high city scores shouldn't dominate
  const impactBoost = Math.max(0, (max - p75) * 0.08);
  const points = Math.min(0.5, impactBoost);

  return {
    id: 'city_risk_max',
    label: 'Max City Risk',
    category: 'distribution',
    observed: `max: ${round(max, 1)}/10`,
    points: round(points, 2),
    notes: max >= 7 ? 'High-impact city (capped)' : max >= 5 ? 'Elevated impact (capped)' : 'No significant outliers',
    dayIndex,
    scope: 'region',
    meta: { max, p75, impactBoost },
  };
}

/**
 * Factor: Snow Hazard (p90 + coverage)
 * Regional multipliers apply: SE/Southern Plains 2x, Northeast 0.75x
 */
function factorSnowHazard(
  metrics: RegionWeatherMetrics,
  dayIndex: number,
  regionId?: string
): RiskFactor {
  const { snow_p90, snow_max, snow_coverage, snow_trace_coverage, cityCount } = metrics;

  let points = 0;
  let notes = 'None';

  // Intensity component
  if (snow_p90 >= 6) {
    points += 2.5;
    notes = 'Widespread heavy snow';
  } else if (snow_p90 >= 4) {
    points += 2.0;
    notes = 'Significant snow p90';
  } else if (snow_p90 >= 2) {
    points += 1.4;
    notes = 'Moderate snow p90';
  } else if (snow_p90 >= 1) {
    points += 0.9;
    notes = 'Light-moderate snow';
  } else if (snow_p90 >= 0.5) {
    points += 0.4;
    notes = 'Light snow';
  } else if (snow_max >= 0.5) {
    points += 0.2;
    notes = 'Isolated snow';
  }

  // Coverage component
  if (snow_coverage >= 0.7) {
    points += 0.8;
    notes += ' (70%+ coverage)';
  } else if (snow_coverage >= 0.5) {
    points += 0.5;
    notes += ' (50%+ coverage)';
  } else if (snow_coverage >= 0.3) {
    points += 0.3;
    notes += ' (30%+ coverage)';
  } else if (snow_coverage >= 0.1) {
    points += 0.15;
  }

  // Apply regional multiplier (southern regions get higher scores, northeast gets reduced)
  const regionMultiplier = regionId ? (SNOW_REGION_MULTIPLIERS[regionId] || 1.0) : 1.0;
  const adjustedPoints = points * regionMultiplier;

  // Add multiplier info to notes if applied and non-default
  const multiplierNote = regionMultiplier !== 1.0
    ? ` (${regionMultiplier}x regional adjustment)`
    : '';

  const citiesWithSnow = Math.round(snow_coverage * cityCount);

  return {
    id: 'snow_hazard',
    label: 'Snow Hazard',
    category: 'snow',
    observed: `p90 ${snow_p90.toFixed(1)}" (${citiesWithSnow}/${cityCount} cities >= 1")`,
    points: round(Math.min(7.0, adjustedPoints), 2), // Cap raised to 7.0 for doubled regions
    notes: notes + multiplierNote,
    dayIndex,
    scope: 'region',
    meta: { snow_p90, snow_max, snow_coverage, citiesWithSnow, regionMultiplier },
  };
}

/**
 * Factor: Rain/Flood Hazard (p90 + coverage)
 */
function factorRainHazard(
  metrics: RegionWeatherMetrics,
  dayIndex: number
): RiskFactor {
  const { rain_p90, rain_max, rain_coverage, rain_heavy_coverage, cityCount } = metrics;

  let points = 0;
  let notes = 'None';

  // Intensity component
  if (rain_p90 >= 2) {
    points += 2.0;
    notes = 'Widespread heavy rain';
  } else if (rain_p90 >= 1) {
    points += 1.4;
    notes = 'Significant rain p90';
  } else if (rain_p90 >= 0.5) {
    points += 0.8;
    notes = 'Moderate rain';
  } else if (rain_p90 >= 0.25) {
    points += 0.4;
    notes = 'Light-moderate rain';
  } else if (rain_max >= 0.5) {
    points += 0.2;
    notes = 'Isolated heavier rain';
  }

  // Coverage component
  if (rain_heavy_coverage >= 0.5) {
    points += 0.7;
    notes += ' (heavy rain widespread)';
  } else if (rain_coverage >= 0.7) {
    points += 0.5;
    notes += ' (broad coverage)';
  } else if (rain_coverage >= 0.5) {
    points += 0.3;
    notes += ' (moderate coverage)';
  } else if (rain_coverage >= 0.25) {
    points += 0.15;
  }

  const citiesWithRain = Math.round(rain_coverage * cityCount);

  return {
    id: 'rain_hazard',
    label: 'Rain/Flood Hazard',
    category: 'rain',
    observed: `p90 ${rain_p90.toFixed(2)}" (${citiesWithRain}/${cityCount} cities >= 0.25")`,
    points: round(Math.min(2.8, points), 2),
    notes,
    dayIndex,
    scope: 'region',
    meta: { rain_p90, rain_max, rain_coverage, rain_heavy_coverage, citiesWithRain },
  };
}

/**
 * Factor: Ice Hazard (NBM FRAM - p90 + coverage)
 * Ice is extremely hazardous even in small amounts
 * Regional multipliers apply: SE/Southern Plains 2x (less ice infrastructure)
 */
function factorIceHazard(
  metrics: RegionWeatherMetrics,
  dayIndex: number,
  regionId?: string
): RiskFactor {
  const { ice_p90, ice_max, ice_coverage, ice_heavy_coverage, cityCount } = metrics;

  if (ice_p90 <= 0 && ice_max <= 0) {
    return {
      id: 'ice_hazard',
      label: 'Ice Accumulation Hazard',
      category: 'ice',
      observed: 'None',
      points: 0,
      notes: 'No ice accumulation forecast',
      dayIndex,
      scope: 'region',
    };
  }

  let points = 0;
  let notes = 'Trace ice';

  // Intensity component - ice is dangerous even in small amounts
  if (ice_p90 >= 0.5) {
    points += 2.5;
    notes = 'Widespread significant ice';
  } else if (ice_p90 >= 0.25) {
    points += 1.8;
    notes = 'Moderate ice p90';
  } else if (ice_p90 >= 0.1) {
    points += 1.2;
    notes = 'Light ice p90';
  } else if (ice_max >= 0.25) {
    points += 0.8;
    notes = 'Isolated moderate ice';
  } else if (ice_max >= 0.1) {
    points += 0.4;
    notes = 'Isolated light ice';
  } else if (ice_max > 0) {
    points += 0.2;
    notes = 'Trace ice';
  }

  // Coverage component - ice affects travel broadly
  if (ice_heavy_coverage >= 0.3) {
    points += 0.8;
    notes += ' (heavy ice widespread)';
  } else if (ice_coverage >= 0.5) {
    points += 0.6;
    notes += ' (broad coverage)';
  } else if (ice_coverage >= 0.3) {
    points += 0.4;
    notes += ' (moderate coverage)';
  } else if (ice_coverage >= 0.1) {
    points += 0.2;
  }

  // Apply regional multiplier (southern regions get higher scores)
  const regionMultiplier = regionId ? (ICE_REGION_MULTIPLIERS[regionId] || 1.0) : 1.0;
  const adjustedPoints = points * regionMultiplier;

  // Add multiplier info to notes if applied and non-default
  const multiplierNote = regionMultiplier !== 1.0
    ? ` (${regionMultiplier}x regional adjustment)`
    : '';

  const citiesWithIce = Math.round(ice_coverage * cityCount);

  return {
    id: 'ice_hazard',
    label: 'Ice Accumulation Hazard',
    category: 'ice',
    observed: `p90 ${ice_p90.toFixed(2)}" (${citiesWithIce}/${cityCount} cities >= 0.1")`,
    points: round(Math.min(7.0, adjustedPoints), 2), // Cap raised to 7.0 for doubled regions
    notes: notes + multiplierNote,
    dayIndex,
    scope: 'region',
    meta: { ice_p90, ice_max, ice_coverage, ice_heavy_coverage, citiesWithIce, regionMultiplier },
  };
}

/**
 * Factor: Wind Hazard (p90 + coverage)
 */
function factorWindHazard(
  metrics: RegionWeatherMetrics,
  dayIndex: number
): RiskFactor {
  const { wind_gust_p90, wind_gust_max, wind_coverage, wind_high_coverage, cityCount } = metrics;

  let points = 0;
  let notes = 'Light';

  // Intensity component
  if (wind_gust_p90 >= 50) {
    points += 2.0;
    notes = 'Widespread high winds';
  } else if (wind_gust_p90 >= 40) {
    points += 1.4;
    notes = 'Significant wind p90';
  } else if (wind_gust_p90 >= 35) {
    points += 0.9;
    notes = 'Elevated wind p90';
  } else if (wind_gust_p90 >= 30) {
    points += 0.5;
    notes = 'Moderate winds';
  } else if (wind_gust_max >= 40) {
    points += 0.3;
    notes = 'Isolated strong gusts';
  } else if (wind_gust_max >= 30) {
    points += 0.15;
    notes = 'Occasional gusts';
  }

  // Coverage component
  if (wind_high_coverage >= 0.4) {
    points += 0.5;
    notes += ' (high winds widespread)';
  } else if (wind_coverage >= 0.6) {
    points += 0.4;
    notes += ' (broad coverage)';
  } else if (wind_coverage >= 0.4) {
    points += 0.25;
    notes += ' (moderate coverage)';
  } else if (wind_coverage >= 0.2) {
    points += 0.1;
  }

  const citiesWindy = Math.round(wind_coverage * cityCount);

  return {
    id: 'wind_hazard',
    label: 'Wind Hazard',
    category: 'wind',
    observed: `p90 ${Math.round(wind_gust_p90)} mph (${citiesWindy}/${cityCount} cities >= 30 mph)`,
    points: round(Math.min(2.5, points), 2),
    notes,
    dayIndex,
    scope: 'region',
    meta: { wind_gust_p90, wind_gust_max, wind_coverage, citiesWindy },
  };
}

/**
 * Factor: Cold Hazard (p10 + coverage)
 */
function factorColdHazard(
  metrics: RegionWeatherMetrics,
  dayIndex: number
): RiskFactor {
  const { temp_min_p10, cold_coverage, extreme_cold_coverage, cityCount } = metrics;

  let points = 0;
  let notes = 'Mild';

  // Intensity component
  if (temp_min_p10 <= -10) {
    points += 1.2;
    notes = 'Extreme cold (p10 <= -10°F)';
  } else if (temp_min_p10 <= 0) {
    points += 0.8;
    notes = 'Dangerous cold';
  } else if (temp_min_p10 <= 10) {
    points += 0.5;
    notes = 'Very cold';
  } else if (temp_min_p10 <= 20) {
    points += 0.25;
    notes = 'Cold';
  } else if (temp_min_p10 <= 28) {
    points += 0.1;
    notes = 'Below freezing';
  }

  // Coverage component
  if (extreme_cold_coverage >= 0.3) {
    points += 0.5;
    notes += ' (extreme cold widespread)';
  } else if (cold_coverage >= 0.5) {
    points += 0.35;
    notes += ' (broad cold coverage)';
  } else if (cold_coverage >= 0.3) {
    points += 0.2;
    notes += ' (moderate cold coverage)';
  }

  const citiesCold = Math.round(cold_coverage * cityCount);

  return {
    id: 'cold_hazard',
    label: 'Cold Hazard',
    category: 'cold',
    observed: `p10 ${Math.round(temp_min_p10)}°F (${citiesCold}/${cityCount} cities <= 20°F)`,
    points: round(Math.min(1.8, points), 2),
    notes,
    dayIndex,
    scope: 'region',
    meta: { temp_min_p10, cold_coverage, extreme_cold_coverage, citiesCold },
  };
}

/**
 * Factor: Heat Hazard (p90 + coverage)
 */
function factorHeatHazard(
  metrics: RegionWeatherMetrics,
  dayIndex: number
): RiskFactor {
  const { temp_max_p90, heat_coverage, extreme_heat_coverage, cityCount } = metrics;

  let points = 0;
  let notes = 'Normal';

  // Intensity component
  if (temp_max_p90 >= 105) {
    points += 1.6;
    notes = 'Extreme heat (p90 >= 105°F)';
  } else if (temp_max_p90 >= 100) {
    points += 1.1;
    notes = 'Excessive heat';
  } else if (temp_max_p90 >= 95) {
    points += 0.6;
    notes = 'Very hot';
  } else if (temp_max_p90 >= 90) {
    points += 0.25;
    notes = 'Hot';
  }

  // Coverage component
  if (extreme_heat_coverage >= 0.4) {
    points += 0.5;
    notes += ' (extreme heat widespread)';
  } else if (heat_coverage >= 0.6) {
    points += 0.35;
    notes += ' (broad heat coverage)';
  } else if (heat_coverage >= 0.3) {
    points += 0.2;
  }

  const citiesHot = Math.round(heat_coverage * cityCount);

  return {
    id: 'heat_hazard',
    label: 'Heat Hazard',
    category: 'heat',
    observed: `p90 ${Math.round(temp_max_p90)}°F (${citiesHot}/${cityCount} cities >= 95°F)`,
    points: round(Math.min(2.2, points), 2),
    notes,
    dayIndex,
    scope: 'region',
    meta: { temp_max_p90, heat_coverage, extreme_heat_coverage, citiesHot },
  };
}

/**
 * Factor: Winter Travel Hazard
 */
function factorWinterTravelHazard(
  metrics: RegionWeatherMetrics,
  dayIndex: number
): RiskFactor {
  const { snow_p90, snow_coverage, wind_gust_p90, wind_coverage, cold_coverage, cityCount } = metrics;

  if (snow_p90 < 0.5) {
    return {
      id: 'winter_travel_hazard',
      label: 'Winter Travel Hazard',
      category: 'travel',
      observed: 'N/A',
      points: 0,
      notes: 'No significant snow',
      dayIndex,
      scope: 'region',
    };
  }

  let points = 0;
  const factors: string[] = [];

  // Snow component
  if (snow_p90 >= 2 && snow_coverage >= 0.4) {
    points += 0.5;
    factors.push('snow');
  } else if (snow_p90 >= 1) {
    points += 0.25;
    factors.push('snow');
  }

  // Wind + snow
  if (wind_gust_p90 >= 30 && snow_p90 >= 1) {
    points += 0.4;
    factors.push('blowing snow');
  }

  // Cold + snow
  if (cold_coverage >= 0.3 && snow_p90 >= 1) {
    points += 0.3;
    factors.push('cold');
  }

  // Synergy
  if (factors.length >= 3) {
    points += 0.2;
  }

  return {
    id: 'winter_travel_hazard',
    label: 'Winter Travel Hazard',
    category: 'travel',
    observed: `Snow p90 ${snow_p90.toFixed(1)}", Wind p90 ${Math.round(wind_gust_p90)} mph`,
    points: round(Math.min(1.4, points), 2),
    notes: factors.length > 0 ? factors.join(' + ') : 'Minor',
    dayIndex,
    scope: 'region',
    meta: { snow_p90, wind_gust_p90, cold_coverage },
  };
}

/**
 * Factor: SPC Overlay (affected cities + category) - Days 1-3 only
 */
function factorSPCOverlay(
  metrics: RegionWeatherMetrics,
  dayIndex: number
): RiskFactor {
  const { spc_max, spc_coverage, cityCount } = metrics;

  if (!spc_max || dayIndex > 3) {
    return {
      id: 'spc_overlay',
      label: 'SPC Convective Outlook',
      category: 'overlay',
      observed: dayIndex > 3 ? 'N/A (Day 4+)' : 'None',
      points: 0,
      notes: dayIndex > 3 ? 'SPC only valid Days 1-3' : 'No SPC risk',
      dayIndex,
      scope: 'region',
    };
  }

  // Base points from max category
  const basePoints: Record<string, number> = {
    'TSTM': 0.2, 'MRGL': 1.0, 'SLGT': 1.8, 'ENH': 3.2, 'MDT': 5.0, 'HIGH': 7.0
  };

  let points = basePoints[spc_max] || 0;

  // Coverage boost (more cities affected = higher impact)
  if (spc_coverage >= 0.5) {
    points *= 1.3;
  } else if (spc_coverage >= 0.3) {
    points *= 1.15;
  }

  const citiesAffected = Math.round(spc_coverage * cityCount);
  const notes: Record<string, string> = {
    'TSTM': 'General thunderstorm risk',
    'MRGL': 'Marginal severe risk',
    'SLGT': 'Slight severe risk',
    'ENH': 'Enhanced severe risk',
    'MDT': 'Moderate severe risk',
    'HIGH': 'High severe risk',
  };

  return {
    id: 'spc_overlay',
    label: 'SPC Convective Outlook',
    category: 'overlay',
    observed: `${spc_max} (${citiesAffected}/${cityCount} cities, ${Math.round(spc_coverage * 100)}% coverage)`,
    points: round(Math.min(8.0, points), 2),
    notes: notes[spc_max] || 'Severe risk',
    dayIndex,
    scope: 'region',
    meta: {
      max_spc_category: spc_max,
      max_spc_city: metrics.spc_max_city,
      avg_spc_points: metrics.spc_avg_points,
      spc_coverage,
      citiesAffected,
      city_breakdown: metrics.spc_city_breakdown,
    },
  };
}

/**
 * Factor: SPC Day 4-8 Overlay (affected cities + category) - Days 4-8 only
 */
function factorSPCDay48Overlay(
  metrics: RegionWeatherMetrics,
  dayIndex: number
): RiskFactor {
  const { spc_day48_max, spc_day48_max_dn, spc_day48_coverage, cityCount } = metrics;

  if (!spc_day48_max || dayIndex < 4 || dayIndex > 8) {
    return {
      id: 'spc_day48_overlay',
      label: 'SPC Day 4-8 Outlook',
      category: 'overlay',
      observed: (dayIndex < 4) ? 'N/A (Day 1-3)' : (dayIndex > 8) ? 'N/A (Day 9+)' : 'None',
      points: 0,
      notes: (dayIndex < 4) ? 'Day 4-8 outlook only valid Days 4-8' : 'No SPC D4-8 risk',
      dayIndex,
      scope: 'region',
    };
  }

  // Base points from max category (same as city level)
  const basePoints: Record<string, number> = {
    'SLGT': 1.8,  // 15% probability
    'ENH': 3.2,   // 30% probability
  };

  let points = basePoints[spc_day48_max] || 0;

  // Coverage boost (more cities affected = higher impact)
  if (spc_day48_coverage >= 0.5) {
    points *= 1.3;
  } else if (spc_day48_coverage >= 0.3) {
    points *= 1.15;
  }

  const citiesAffected = Math.round(spc_day48_coverage * cityCount);
  const dnLabel = spc_day48_max_dn ? `${spc_day48_max_dn}%` : '';
  const displayLabel = spc_day48_max_dn === 15 ? 'SLGT (D4-8)' :
                       spc_day48_max_dn === 30 ? 'ENH (D4-8)' :
                       `${spc_day48_max} (D4-8)`;

  const notes: Record<string, string> = {
    'SLGT': `15% probability severe (D4-8)`,
    'ENH': `30%+ probability severe (D4-8)`,
  };

  return {
    id: 'spc_day48_overlay',
    label: 'SPC Day 4-8 Outlook',
    category: 'overlay',
    observed: `${displayLabel} (${citiesAffected}/${cityCount} cities, ${Math.round(spc_day48_coverage * 100)}% coverage)`,
    points: round(Math.min(4.0, points), 2),
    notes: notes[spc_day48_max] || 'Severe risk (D4-8)',
    dayIndex,
    scope: 'region',
    meta: {
      max_spc_day48_category: spc_day48_max,
      max_spc_day48_dn: spc_day48_max_dn,
      max_spc_day48_city: metrics.spc_day48_max_city,
      avg_spc_day48_points: metrics.spc_day48_avg_points,
      spc_day48_coverage,
      citiesAffected,
      city_breakdown: metrics.spc_day48_city_breakdown,
    },
  };
}

/**
 * Factor: WPC ERO Overlay (affected cities + category) - Days 1-5
 */
function factorEROOverlay(
  metrics: RegionWeatherMetrics,
  dayIndex: number
): RiskFactor {
  const { ero_max, ero_coverage, cityCount } = metrics;

  if (!ero_max || dayIndex > 5) {
    return {
      id: 'wpc_ero_overlay',
      label: 'WPC Excessive Rainfall Outlook',
      category: 'overlay',
      observed: dayIndex > 5 ? 'N/A (Day 6+)' : 'None',
      points: 0,
      notes: dayIndex > 5 ? 'ERO only valid Days 1-5' : 'No ERO risk',
      dayIndex,
      scope: 'region',
    };
  }

  // Base points from max category
  const basePoints: Record<string, number> = {
    'MRGL': 0.3, 'SLGT': 1.0, 'MDT': 1.8, 'HIGH': 3.5
  };

  let points = basePoints[ero_max] || 0;

  // Coverage boost
  if (ero_coverage >= 0.3) {
    points *= 1.15;
  }

  const citiesAffected = Math.round(ero_coverage * cityCount);
  const notes: Record<string, string> = {
    'MRGL': 'Marginal excessive rainfall',
    'SLGT': 'Slight excessive rainfall',
    'MDT': 'Moderate excessive rainfall',
    'HIGH': 'High excessive rainfall',
  };

  return {
    id: 'wpc_ero_overlay',
    label: 'WPC Excessive Rainfall Outlook',
    category: 'overlay',
    observed: `${ero_max} (${citiesAffected}/${cityCount} cities, ${Math.round(ero_coverage * 100)}% coverage)`,
    points: round(Math.min(4.5, points), 2),
    notes: notes[ero_max] || 'Excessive rainfall',
    dayIndex,
    scope: 'region',
    meta: { ero_max, ero_coverage, citiesAffected },
  };
}

/**
 * Factor: WPC Winter Storm Severity Index (affected cities + category) - Days 1-3 only
 * Max points: 5.5 (capped at 6.0)
 */
function factorWSSIOverlay(
  metrics: RegionWeatherMetrics,
  dayIndex: number
): RiskFactor {
  const { wssi_max, wssi_coverage, cityCount } = metrics;

  if (!wssi_max || dayIndex > 3) {
    return {
      id: 'wpc_wssi_overlay',
      label: 'Winter Storm Severity Index',
      category: 'overlay',
      observed: dayIndex > 3 ? 'N/A (Day 4+)' : 'None',
      points: 0,
      notes: dayIndex > 3 ? 'WSSI only valid Days 1-3' : 'No WSSI risk',
      dayIndex,
      scope: 'region',
    };
  }

  // Base points from max category (matches city-level)
  const basePoints: Record<string, number> = {
    'WINTER WEATHER AREA': 0.5,
    'MINOR': 1.2,
    'MODERATE': 2.2,
    'MAJOR': 3.5,
    'EXTREME': 5.0,
  };

  let points = basePoints[wssi_max] || 0;

  // Coverage boost (more cities affected = higher impact)
  if (wssi_coverage >= 0.5) {
    points *= 1.25;
  } else if (wssi_coverage >= 0.3) {
    points *= 1.12;
  }

  const citiesAffected = Math.round(wssi_coverage * cityCount);
  const displayNames: Record<string, string> = {
    'WINTER WEATHER AREA': 'WWA',
    'MINOR': 'Minor',
    'MODERATE': 'Moderate',
    'MAJOR': 'Major',
    'EXTREME': 'Extreme',
  };
  const notes: Record<string, string> = {
    'WINTER WEATHER AREA': 'Winter weather area',
    'MINOR': 'Minor winter storm impacts',
    'MODERATE': 'Moderate winter storm impacts',
    'MAJOR': 'Major winter storm impacts',
    'EXTREME': 'Extreme winter storm impacts',
  };

  return {
    id: 'wpc_wssi_overlay',
    label: 'Winter Storm Severity Index',
    category: 'overlay',
    observed: `${displayNames[wssi_max] || wssi_max} (${citiesAffected}/${cityCount} cities, ${Math.round(wssi_coverage * 100)}% coverage)`,
    points: round(Math.min(6.0, points), 2),
    notes: notes[wssi_max] || 'Winter storm impacts',
    dayIndex,
    scope: 'region',
    meta: {
      max_wssi_category: wssi_max,
      max_wssi_city: metrics.wssi_max_city,
      avg_wssi_points: metrics.wssi_avg_points,
      wssi_coverage,
      citiesAffected,
      city_breakdown: metrics.wssi_city_breakdown,
    },
  };
}

/**
 * Factor: Multi-Hazard Synergy
 */
function factorMultiHazardSynergy(
  factors: RiskFactor[],
  dayIndex: number
): RiskFactor {
  const excludeIds = ['city_risk_p75', 'city_risk_max', 'multi_hazard_synergy'];
  const significantHazards = factors.filter(f =>
    f.points >= 0.5 && !excludeIds.includes(f.id)
  );

  let points = 0;
  let notes = 'Single hazard or quiet';

  if (significantHazards.length >= 4) {
    points = 0.5;
    notes = 'Multiple significant hazards';
  } else if (significantHazards.length >= 3) {
    points = 0.35;
    notes = '3 hazards combining';
  } else if (significantHazards.length >= 2) {
    points = 0.2;
    notes = '2 hazards present';
  }

  const hazardNames = significantHazards.map(f => f.label);

  return {
    id: 'multi_hazard_synergy',
    label: 'Multi-Hazard Synergy',
    category: 'synergy',
    observed: `${significantHazards.length} active hazards`,
    points: round(points, 2),
    notes: hazardNames.length > 0 ? hazardNames.slice(0, 3).join(', ') : notes,
    dayIndex,
    scope: 'region',
    meta: { hazardCount: significantHazards.length, hazards: hazardNames },
  };
}

// ============================================================================
// Summary Generation
// ============================================================================

function generateRegionSummary(
  factors: RiskFactor[],
  metrics: RegionWeatherMetrics,
  score: number,
  dayIndex: number
): string {
  if (score < 1.5) {
    return 'No significant weather hazards expected across the region.';
  }

  const sentences: string[] = [];
  const topDrivers = deriveTopDrivers(factors);

  // Identify dominant hazard type
  const snowFactor = factors.find(f => f.id === 'snow_hazard');
  const rainFactor = factors.find(f => f.id === 'rain_hazard');
  const spcFactor = factors.find(f => f.id === 'spc_overlay');
  const wssiFactor = factors.find(f => f.id === 'wpc_wssi_overlay');
  const windFactor = factors.find(f => f.id === 'wind_hazard');
  const heatFactor = factors.find(f => f.id === 'heat_hazard');

  if (spcFactor && spcFactor.points >= 2) {
    const covPct = Math.round(metrics.spc_coverage * 100);
    sentences.push(`Elevated severe weather risk (${metrics.spc_max}) affecting ${covPct}% of the region.`);
  } else if (wssiFactor && wssiFactor.points >= 1.5) {
    const covPct = Math.round(metrics.wssi_coverage * 100);
    const displayName = metrics.wssi_max === 'WINTER WEATHER AREA' ? 'WWA' : metrics.wssi_max;
    sentences.push(`Winter storm impacts (${displayName}) affecting ${covPct}% of the region.`);
  } else if (snowFactor && snowFactor.points >= 1) {
    const { snow_p90, snow_coverage, cityCount } = metrics;
    const citiesWithSnow = Math.round(snow_coverage * cityCount);
    sentences.push(`Snow impacts with p90 ${snow_p90.toFixed(1)}" affecting ${citiesWithSnow}/${cityCount} cities.`);
  } else if (rainFactor && rainFactor.points >= 0.8) {
    const { rain_p90, rain_coverage, cityCount } = metrics;
    const citiesWithRain = Math.round(rain_coverage * cityCount);
    sentences.push(`Rain impacts with p90 ${rain_p90.toFixed(2)}" affecting ${citiesWithRain}/${cityCount} cities.`);
  } else if (windFactor && windFactor.points >= 0.8) {
    sentences.push(`Windy conditions with p90 gusts near ${Math.round(metrics.wind_gust_p90)} mph.`);
  } else if (heatFactor && heatFactor.points >= 0.5) {
    sentences.push(`Hot conditions with p90 highs near ${Math.round(metrics.temp_max_p90)}°F.`);
  }

  // Add secondary hazard if significant
  const secondaryHazards = topDrivers.filter(f =>
    f.points >= 0.5 &&
    !['city_risk_p75', 'city_risk_max'].includes(f.id) &&
    f.id !== topDrivers[0]?.id
  );

  if (secondaryHazards.length > 0 && sentences.length > 0) {
    const names = secondaryHazards.slice(0, 2).map(f => f.label.split(' ')[0]);
    sentences.push(`${names.join(' and ')} add to regional impacts.`);
  }

  if (dayIndex >= 6) {
    sentences.push('Extended range forecast confidence is lower.');
  }

  return sentences.length > 0 ? sentences.join(' ') : 'Weather impacts expected.';
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Compute region risk score for a specific day with full factor breakdown
 *
 * @param dayIndex - 1-7 (Day 1 = today)
 * @param cityRiskResults - Array of city risk results with scores and weather data
 * @param regionMetrics - Pre-computed region weather metrics (or null to compute)
 * @param regionId - Region identifier for regional multipliers (e.g., 'southeast', 'northeast')
 * @returns RiskScoreResult with factors, score, and explainer
 */
export function computeRegionRisk(
  dayIndex: number,
  cityRiskResults: CityRiskInput[],
  regionMetrics?: RegionWeatherMetrics,
  regionId?: string
): RiskScoreResult {
  const dayIdx = Math.max(1, Math.min(7, dayIndex));

  // Compute metrics if not provided
  const metrics = regionMetrics || computeRegionMetrics(cityRiskResults);

  if (metrics.cityCount === 0) {
    return {
      score_raw: 1.0,
      score_display: 1.0,
      level: 'very-quiet',
      factors: [],
      top_drivers: [],
      summary: 'No data available.',
    };
  }

  const cityScores = cityRiskResults.map(c => c.score);
  const factors: RiskFactor[] = [];

  // ===== DISTRIBUTION FACTORS =====
  factors.push(factorCityRiskDistribution(cityScores, dayIdx));
  factors.push(factorMaxCityRisk(cityScores, dayIdx));

  // ===== HAZARD FACTORS =====
  // Regional multipliers apply: SE/Southern Plains 2x for snow/ice, Northeast 0.75x for snow
  factors.push(factorSnowHazard(metrics, dayIdx, regionId));
  factors.push(factorRainHazard(metrics, dayIdx));
  factors.push(factorIceHazard(metrics, dayIdx, regionId));  // NBM FRAM ice accumulation
  factors.push(factorWindHazard(metrics, dayIdx));
  factors.push(factorColdHazard(metrics, dayIdx));
  factors.push(factorHeatHazard(metrics, dayIdx));
  factors.push(factorWinterTravelHazard(metrics, dayIdx));

  // ===== SYNERGY FACTOR =====
  factors.push(factorMultiHazardSynergy(factors, dayIdx));

  // ===== OVERLAY FACTORS =====
  // Days 1-3: SPC, ERO, WSSI
  factors.push(factorSPCOverlay(metrics, dayIdx));
  factors.push(factorEROOverlay(metrics, dayIdx));
  factors.push(factorWSSIOverlay(metrics, dayIdx));
  // Days 4-8: SPC Day 4-8 probabilistic outlook
  factors.push(factorSPCDay48Overlay(metrics, dayIdx));

  // ===== COMPUTE FINAL SCORE =====
  // Sum all factor points - this IS the score
  let rawScore = factors.reduce((sum, f) => sum + f.points, 0);

  // Apply day damping for extended forecasts
  rawScore = applyDayDamping(rawScore, dayIdx);

  // Clamp to 0-10
  rawScore = clamp(rawScore, 0, 10);

  // ===== BUILD RESULT =====
  const topDrivers = deriveTopDrivers(factors);
  const summary = generateRegionSummary(factors, metrics, rawScore, dayIdx);

  return {
    score_raw: round(rawScore, 2),
    score_display: round(rawScore, 1),
    level: scoreToLevel(rawScore),
    factors,
    top_drivers: topDrivers,
    summary,
  };
}
