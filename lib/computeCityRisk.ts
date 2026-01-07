/**
 * Canonical City Risk Scoring Pipeline
 *
 * City risk score = clamp(sum(points of city factors) + synergy + overlay, 0..10)
 *
 * This is THE SINGLE SOURCE OF TRUTH for city risk calculation.
 * Score and explainer are derived from the same factor list.
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
  applyDayDamping,
  SPC_POINTS,
  ERO_POINTS,
  WSSI_POINTS,
  SPC_DAY48_POINTS,
  ICE_POINTS_THRESHOLDS,
  ICE_REGION_MULTIPLIERS,
} from './riskTypes';

// ============================================================================
// Input Types
// ============================================================================

export interface CityDayInput {
  tmax_f: number;
  tmin_f: number;
  wind_gust_mph: number;
  rain_in: number;
  snow_in: number;
  // NBM ice accumulation (FRAM) in inches - from NWS gridpoints API
  ice_in?: number;
  // Hourly data (optional, improves accuracy)
  hourlyPrecip?: number[];
  hourlySnow?: number[];
  hourlyTemp?: number[];
  hourlyWindGust?: number[];
}

export interface CityOverlays {
  // Day 1-3 overlays
  spcCategory?: 'TSTM' | 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';
  eroCategory?: 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';
  wssiCategory?: 'WINTER WEATHER AREA' | 'MINOR' | 'MODERATE' | 'MAJOR' | 'EXTREME';
  // Day 4-8 SPC overlay (probabilistic)
  spcDay48Category?: 'SLGT' | 'ENH';  // 15% = SLGT, 30% = ENH
  spcDay48Dn?: number | null;          // Raw DN value (15 or 30)
}

// ============================================================================
// Factor Functions (15+ factors)
// ============================================================================

/**
 * Factor: Snow Amount (daily total)
 * Max points: 4.0
 */
function factorSnowAmount(
  snowIn: number,
  dayIndex: number
): RiskFactor {
  let points = 0;
  let notes = 'None';

  if (snowIn <= 0) {
    points = 0;
    notes = 'None';
  } else if (snowIn < 0.2) {
    // Tiny snow bump (trace amounts)
    points = 0.1 + snowIn * 0.5;
    notes = 'Trace';
  } else if (snowIn < 0.5) {
    points = 0.2 + (snowIn - 0.2) * 0.7;
    notes = 'Dusting';
  } else if (snowIn < 1) {
    points = 0.4 + (snowIn - 0.5) * 1.2;
    notes = 'Light coating';
  } else if (snowIn < 2) {
    points = 1.0 + (snowIn - 1) * 0.6;
    notes = `${snowIn.toFixed(1)}" accumulating`;
  } else if (snowIn < 4) {
    points = 1.6 + (snowIn - 2) * 0.45;
    notes = `${snowIn.toFixed(1)}" moderate`;
  } else if (snowIn < 6) {
    points = 2.5 + (snowIn - 4) * 0.4;
    notes = `${snowIn.toFixed(1)}" heavy`;
  } else if (snowIn < 12) {
    points = 3.3 + (snowIn - 6) * 0.12;
    notes = `${snowIn.toFixed(1)}" major`;
  } else {
    points = 4.0;
    notes = `${snowIn.toFixed(1)}" extreme`;
  }

  return {
    id: 'snow_amount',
    label: 'Snow Accumulation',
    category: 'snow',
    observed: `${snowIn.toFixed(2)}"`,
    points: round(Math.min(4.0, points), 2),
    notes,
    dayIndex,
    scope: 'city',
    meta: { snowIn },
  };
}

/**
 * Factor: Snow Rate (intensity proxy)
 * Max points: 1.5
 */
function factorSnowRate(
  snowIn: number,
  hourlySnow: number[] | undefined,
  dayIndex: number
): RiskFactor {
  let maxHourlySnow = 0;

  if (hourlySnow && hourlySnow.length > 0) {
    maxHourlySnow = Math.max(...hourlySnow);
  } else {
    // Estimate: assume snow falls over 6-12 hours
    maxHourlySnow = snowIn > 0 ? snowIn / 8 : 0;
  }

  let points = 0;
  let notes = 'Light or none';

  if (maxHourlySnow >= 2) {
    points = 1.5;
    notes = 'Extreme rate (>2"/hr)';
  } else if (maxHourlySnow >= 1) {
    points = 1.0 + (maxHourlySnow - 1) * 0.5;
    notes = 'Heavy rate (1-2"/hr)';
  } else if (maxHourlySnow >= 0.5) {
    points = 0.5 + (maxHourlySnow - 0.5) * 1.0;
    notes = 'Moderate rate';
  } else if (maxHourlySnow >= 0.2) {
    points = 0.2 + (maxHourlySnow - 0.2) * 1.0;
    notes = 'Light-moderate rate';
  } else if (maxHourlySnow > 0) {
    points = maxHourlySnow;
    notes = 'Light rate';
  }

  return {
    id: 'snow_rate',
    label: 'Snow Rate',
    category: 'snow',
    observed: `${maxHourlySnow.toFixed(2)}"/hr max`,
    points: round(Math.min(1.5, points), 2),
    notes,
    dayIndex,
    scope: 'city',
    meta: { maxHourlySnow },
  };
}

/**
 * Factor: Rain Amount (daily total)
 * Max points: 3.0
 */
function factorRainAmount(
  rainIn: number,
  dayIndex: number
): RiskFactor {
  let points = 0;
  let notes = 'None';

  if (rainIn <= 0) {
    points = 0;
    notes = 'None';
  } else if (rainIn < 0.05) {
    // Tiny precip bump
    points = 0.05 + rainIn * 2;
    notes = 'Trace';
  } else if (rainIn < 0.1) {
    points = 0.15;
    notes = 'Sprinkles';
  } else if (rainIn < 0.25) {
    points = 0.15 + (rainIn - 0.1) * 0.7;
    notes = 'Light rain';
  } else if (rainIn < 0.5) {
    points = 0.25 + (rainIn - 0.25) * 1.0;
    notes = 'Rain';
  } else if (rainIn < 1) {
    points = 0.5 + (rainIn - 0.5) * 1.0;
    notes = 'Moderate rain';
  } else if (rainIn < 2) {
    points = 1.0 + (rainIn - 1) * 0.8;
    notes = `${rainIn.toFixed(2)}" heavy rain`;
  } else if (rainIn < 4) {
    points = 1.8 + (rainIn - 2) * 0.4;
    notes = `${rainIn.toFixed(2)}" very heavy`;
  } else {
    points = 3.0;
    notes = `${rainIn.toFixed(2)}" extreme rain`;
  }

  return {
    id: 'rain_amount',
    label: 'Rain Amount',
    category: 'rain',
    observed: `${rainIn.toFixed(2)}"`,
    points: round(Math.min(3.0, points), 2),
    notes,
    dayIndex,
    scope: 'city',
    meta: { rainIn },
  };
}

/**
 * Factor: Rain Intensity (max hourly rate)
 * Max points: 1.5
 */
function factorRainIntensity(
  rainIn: number,
  hourlyPrecip: number[] | undefined,
  dayIndex: number
): RiskFactor {
  let maxHourlyRain = 0;

  if (hourlyPrecip && hourlyPrecip.length > 0) {
    maxHourlyRain = Math.max(...hourlyPrecip);
  } else {
    maxHourlyRain = rainIn > 0 ? rainIn / 6 : 0;
  }

  let points = 0;
  let notes = 'Light or none';

  if (maxHourlyRain >= 1.0) {
    points = 1.5;
    notes = 'Extreme rate (>1"/hr)';
  } else if (maxHourlyRain >= 0.5) {
    points = 1.0 + (maxHourlyRain - 0.5) * 1.0;
    notes = 'Heavy rate (0.5-1"/hr)';
  } else if (maxHourlyRain >= 0.25) {
    points = 0.5 + (maxHourlyRain - 0.25) * 2.0;
    notes = 'Moderate rate';
  } else if (maxHourlyRain >= 0.1) {
    points = 0.2 + (maxHourlyRain - 0.1) * 2.0;
    notes = 'Light-moderate rate';
  } else if (maxHourlyRain > 0) {
    points = maxHourlyRain * 2;
    notes = 'Light rate';
  }

  return {
    id: 'rain_intensity',
    label: 'Rain Intensity',
    category: 'rain',
    observed: `${maxHourlyRain.toFixed(2)}"/hr max`,
    points: round(Math.min(1.5, points), 2),
    notes,
    dayIndex,
    scope: 'city',
    meta: { maxHourlyRain },
  };
}

/**
 * Factor: Wind Gust Magnitude
 * Max points: 3.0
 */
function factorWindGust(
  gustMph: number,
  dayIndex: number
): RiskFactor {
  let points = 0;
  let notes = 'Light';

  if (gustMph < 20) {
    points = 0;
    notes = 'Light';
  } else if (gustMph < 30) {
    points = 0.2 + (gustMph - 20) * 0.03;
    notes = 'Breezy';
  } else if (gustMph < 40) {
    points = 0.5 + (gustMph - 30) * 0.08;
    notes = 'Windy';
  } else if (gustMph < 50) {
    points = 1.3 + (gustMph - 40) * 0.1;
    notes = 'Very windy';
  } else if (gustMph < 60) {
    points = 2.3 + (gustMph - 50) * 0.05;
    notes = 'High winds';
  } else if (gustMph < 75) {
    points = 2.8 + (gustMph - 60) * 0.013;
    notes = 'Damaging winds';
  } else {
    points = 3.0;
    notes = 'Destructive winds';
  }

  return {
    id: 'wind_gust',
    label: 'Wind Gust',
    category: 'wind',
    observed: `${Math.round(gustMph)} mph`,
    points: round(Math.min(3.0, points), 2),
    notes,
    dayIndex,
    scope: 'city',
    meta: { gustMph },
  };
}

/**
 * Factor: Cold Intensity (tmin)
 * Max points: 1.8 (capped to prevent cold from dominating)
 */
function factorColdIntensity(
  tminF: number,
  dayIndex: number
): RiskFactor {
  let points = 0;
  let notes = 'Mild';

  if (tminF > 32) {
    points = 0;
    notes = 'Above freezing';
  } else if (tminF > 25) {
    points = 0.1 + (32 - tminF) * 0.02;
    notes = 'Cold';
  } else if (tminF > 15) {
    points = 0.25 + (25 - tminF) * 0.04;
    notes = 'Very cold';
  } else if (tminF > 5) {
    points = 0.65 + (15 - tminF) * 0.06;
    notes = 'Bitter cold';
  } else if (tminF > -5) {
    points = 1.25 + (5 - tminF) * 0.04;
    notes = 'Dangerous cold';
  } else if (tminF > -15) {
    points = 1.65 + (-5 - tminF) * 0.015;
    notes = 'Extreme cold';
  } else {
    points = 1.8;
    notes = 'Life-threatening cold';
  }

  return {
    id: 'cold_intensity',
    label: 'Cold Intensity',
    category: 'cold',
    observed: `${Math.round(tminF)}°F low`,
    points: round(Math.min(1.8, points), 2),
    notes,
    dayIndex,
    scope: 'city',
    meta: { tminF },
  };
}

/**
 * Factor: Heat Intensity (tmax)
 * Max points: 2.5
 */
function factorHeatIntensity(
  tmaxF: number,
  dayIndex: number
): RiskFactor {
  let points = 0;
  let notes = 'Normal';

  if (tmaxF < 90) {
    points = 0;
    notes = 'Normal';
  } else if (tmaxF < 95) {
    points = 0.3 + (tmaxF - 90) * 0.1;
    notes = 'Hot';
  } else if (tmaxF < 100) {
    points = 0.8 + (tmaxF - 95) * 0.2;
    notes = 'Very hot';
  } else if (tmaxF < 105) {
    points = 1.8 + (tmaxF - 100) * 0.1;
    notes = 'Excessive heat';
  } else if (tmaxF < 110) {
    points = 2.3 + (tmaxF - 105) * 0.04;
    notes = 'Extreme heat';
  } else {
    points = 2.5;
    notes = 'Dangerous heat';
  }

  return {
    id: 'heat_intensity',
    label: 'Heat Intensity',
    category: 'heat',
    observed: `${Math.round(tmaxF)}°F high`,
    points: round(Math.min(2.5, points), 2),
    notes,
    dayIndex,
    scope: 'city',
    meta: { tmaxF },
  };
}

/**
 * Factor: Ice/Freezing Rain Proxy
 * Max points: 2.0 (ice is dangerous)
 */
function factorIceProxy(
  rainIn: number,
  tminF: number,
  tmaxF: number,
  hourlyTemp: number[] | undefined,
  dayIndex: number
): RiskFactor {
  if (rainIn < 0.05) {
    return {
      id: 'ice_proxy',
      label: 'Ice/Freezing Rain',
      category: 'ice',
      observed: 'N/A',
      points: 0,
      notes: 'No rain',
      dayIndex,
      scope: 'city',
    };
  }

  let freezingHours = 0;
  if (hourlyTemp && hourlyTemp.length > 0) {
    freezingHours = hourlyTemp.filter(t => t <= 32).length;
  } else {
    if (tminF <= 32 && tmaxF <= 34) freezingHours = 12;
    else if (tminF <= 32 && tmaxF <= 38) freezingHours = 6;
    else if (tminF <= 30) freezingHours = 3;
  }

  if (freezingHours < 2) {
    return {
      id: 'ice_proxy',
      label: 'Ice/Freezing Rain',
      category: 'ice',
      observed: 'N/A',
      points: 0,
      notes: 'Temps above freezing',
      dayIndex,
      scope: 'city',
    };
  }

  const iceAmount = rainIn * (freezingHours / 12);
  let points = 0;
  let notes = 'Minor icing possible';

  if (iceAmount >= 0.5 || (rainIn >= 0.5 && freezingHours >= 8)) {
    points = 2.0;
    notes = 'Significant ice accumulation likely';
  } else if (iceAmount >= 0.25 || (rainIn >= 0.25 && freezingHours >= 6)) {
    points = 1.2;
    notes = 'Moderate ice accumulation possible';
  } else if (iceAmount >= 0.1) {
    points = 0.6;
    notes = 'Light ice accumulation possible';
  } else {
    points = 0.3;
    notes = 'Minor icing possible';
  }

  return {
    id: 'ice_proxy',
    label: 'Ice/Freezing Rain',
    category: 'ice',
    observed: `${rainIn.toFixed(2)}" rain, ${freezingHours}hrs <= 32°F`,
    points: round(Math.min(2.0, points), 2),
    notes,
    dayIndex,
    scope: 'city',
    meta: { iceAmount, freezingHours },
  };
}

/**
 * Factor: NBM Ice Accumulation (FRAM - Freezing Rain Accumulation Model)
 * REAL ice accumulation data from NWS NDFD/NBM
 * Max points: 10.0 (catastrophic ice events in less-prepared regions)
 *
 * Regional multipliers apply:
 * - Southern regions (SE, Southern Plains): 1.4x (less ice infrastructure)
 * - Southwest: 1.3x (rare ice events)
 * - Northeast: 1.15x (more prepared but still impactful)
 * - Midwest/Northern Plains: 1.0x (most prepared, baseline)
 * - Northwest: 1.1x (moderate preparation)
 */
function factorIceAccumulation(
  iceIn: number | undefined,
  dayIndex: number,
  regionId?: string
): RiskFactor {
  if (iceIn === undefined || iceIn === null || iceIn <= 0) {
    return {
      id: 'ice_accumulation',
      label: 'Ice Accumulation (NBM)',
      category: 'ice',
      observed: 'None',
      points: 0,
      notes: 'No ice accumulation forecast',
      dayIndex,
      scope: 'city',
    };
  }

  let points = 0;
  let notes = 'Trace';

  if (iceIn >= ICE_POINTS_THRESHOLDS.extreme.min) {
    points = ICE_POINTS_THRESHOLDS.extreme.points;
    notes = 'Extreme ice - catastrophic impacts';
  } else if (iceIn >= ICE_POINTS_THRESHOLDS.heavy.max) {
    // Interpolate between heavy and extreme
    const ratio = (iceIn - ICE_POINTS_THRESHOLDS.heavy.max) /
                  (ICE_POINTS_THRESHOLDS.extreme.min - ICE_POINTS_THRESHOLDS.heavy.max);
    points = ICE_POINTS_THRESHOLDS.heavy.points +
             ratio * (ICE_POINTS_THRESHOLDS.extreme.points - ICE_POINTS_THRESHOLDS.heavy.points);
    notes = 'Heavy ice - major damage potential';
  } else if (iceIn >= ICE_POINTS_THRESHOLDS.moderate.max) {
    // Interpolate between moderate and heavy
    const ratio = (iceIn - ICE_POINTS_THRESHOLDS.moderate.max) /
                  (ICE_POINTS_THRESHOLDS.heavy.max - ICE_POINTS_THRESHOLDS.moderate.max);
    points = ICE_POINTS_THRESHOLDS.moderate.points +
             ratio * (ICE_POINTS_THRESHOLDS.heavy.points - ICE_POINTS_THRESHOLDS.moderate.points);
    notes = 'Moderate ice - significant impacts';
  } else if (iceIn >= ICE_POINTS_THRESHOLDS.light.max) {
    // Interpolate between light and moderate
    const ratio = (iceIn - ICE_POINTS_THRESHOLDS.light.max) /
                  (ICE_POINTS_THRESHOLDS.moderate.max - ICE_POINTS_THRESHOLDS.light.max);
    points = ICE_POINTS_THRESHOLDS.light.points +
             ratio * (ICE_POINTS_THRESHOLDS.moderate.points - ICE_POINTS_THRESHOLDS.light.points);
    notes = 'Light ice - hazardous travel';
  } else if (iceIn >= ICE_POINTS_THRESHOLDS.trace.max) {
    // Interpolate between trace and light
    const ratio = (iceIn - ICE_POINTS_THRESHOLDS.trace.max) /
                  (ICE_POINTS_THRESHOLDS.light.max - ICE_POINTS_THRESHOLDS.trace.max);
    points = ICE_POINTS_THRESHOLDS.trace.points +
             ratio * (ICE_POINTS_THRESHOLDS.light.points - ICE_POINTS_THRESHOLDS.trace.points);
    notes = 'Light ice - slick roads possible';
  } else {
    // Trace ice (< 0.1")
    points = (iceIn / ICE_POINTS_THRESHOLDS.trace.max) * ICE_POINTS_THRESHOLDS.trace.points;
    notes = 'Trace ice - minor icing possible';
  }

  // Apply regional multiplier (southern regions less prepared for ice)
  const regionMultiplier = regionId ? (ICE_REGION_MULTIPLIERS[regionId] || 1.0) : 1.0;
  const adjustedPoints = points * regionMultiplier;

  // Add multiplier info to notes if applied
  const multiplierNote = regionMultiplier > 1.0
    ? ` (${regionMultiplier}x regional adjustment)`
    : '';

  return {
    id: 'ice_accumulation',
    label: 'Ice Accumulation (NBM)',
    category: 'ice',
    observed: `${iceIn.toFixed(2)}"`,
    points: round(Math.min(10.0, adjustedPoints), 2),
    notes: notes + multiplierNote,
    dayIndex,
    scope: 'city',
    meta: { iceIn, regionMultiplier },
  };
}

/**
 * Factor: Winter Travel Hazard Index
 * Max points: 1.5
 */
function factorWinterTravel(
  snowIn: number,
  gustMph: number,
  tminF: number,
  dayIndex: number
): RiskFactor {
  if (snowIn < 0.3) {
    return {
      id: 'winter_travel',
      label: 'Winter Travel Hazard',
      category: 'travel',
      observed: 'N/A',
      points: 0,
      notes: 'No snow accumulation',
      dayIndex,
      scope: 'city',
    };
  }

  let score = 0;
  const factors: string[] = [];

  // Snow contribution
  if (snowIn >= 4) {
    score += 0.6;
    factors.push('heavy snow');
  } else if (snowIn >= 2) {
    score += 0.4;
    factors.push('moderate snow');
  } else if (snowIn >= 1) {
    score += 0.25;
    factors.push('snow');
  } else {
    score += 0.1;
    factors.push('light snow');
  }

  // Wind adds to travel impacts
  if (gustMph >= 35 && snowIn >= 1) {
    score += 0.4;
    factors.push('blowing snow');
  } else if (gustMph >= 25 && snowIn >= 0.5) {
    score += 0.2;
    factors.push('wind');
  }

  // Cold adds to impacts
  if (tminF <= 10 && snowIn >= 1) {
    score += 0.3;
    factors.push('bitter cold');
  } else if (tminF <= 20 && snowIn >= 0.5) {
    score += 0.15;
    factors.push('cold');
  }

  // Synergy bonus
  if (factors.length >= 3) {
    score += 0.2;
  }

  return {
    id: 'winter_travel',
    label: 'Winter Travel Hazard',
    category: 'travel',
    observed: `Snow ${snowIn.toFixed(1)}", Wind ${Math.round(gustMph)} mph, Low ${Math.round(tminF)}°F`,
    points: round(Math.min(1.5, score), 2),
    notes: factors.length > 0 ? factors.join(' + ') : 'Minimal',
    dayIndex,
    scope: 'city',
    meta: { snowIn, gustMph, tminF },
  };
}

/**
 * Factor: Multi-Hazard Synergy Bonus
 * Max points: 0.5
 */
function factorMultiHazardSynergy(
  factors: RiskFactor[],
  dayIndex: number
): RiskFactor {
  // Count significant hazards (>= 0.5 points, excluding derived factors)
  const excludeIds = ['multi_hazard_synergy', 'winter_travel', 'wind_chill'];
  const significantHazards = factors.filter(f =>
    f.points >= 0.5 && !excludeIds.includes(f.id)
  );

  const hazardNames = significantHazards.map(f => f.label);
  let points = 0;
  let notes = 'Single hazard or quiet';

  if (hazardNames.length >= 4) {
    points = 0.5;
    notes = 'Multiple significant hazards';
  } else if (hazardNames.length >= 3) {
    points = 0.4;
    notes = '3 hazards combining';
  } else if (hazardNames.length >= 2) {
    points = 0.25;
    notes = '2 hazards present';
  }

  return {
    id: 'multi_hazard_synergy',
    label: 'Multi-Hazard Synergy',
    category: 'synergy',
    observed: `${hazardNames.length} active hazards`,
    points: round(points, 2),
    notes: hazardNames.length > 0 ? hazardNames.slice(0, 3).join(', ') : notes,
    dayIndex,
    scope: 'city',
    meta: { hazardCount: hazardNames.length, hazards: hazardNames },
  };
}

/**
 * Factor: SPC Convective Outlook (Days 1-3)
 * Max points: 8.0 (MRGL +1.2, SLGT +2.0, ENH +4.0, MDT +6.0, HIGH +8.0)
 */
function factorSPCOverlay(
  spcCategory: string | undefined,
  dayIndex: number
): RiskFactor {
  if (!spcCategory || dayIndex > 3) {
    return {
      id: 'spc_outlook',
      label: 'SPC Convective Outlook',
      category: 'overlay',
      observed: dayIndex > 3 ? 'N/A (Day 4+)' : 'None',
      points: 0,
      notes: dayIndex > 3 ? 'SPC D1-3 only valid Days 1-3' : 'No SPC risk',
      dayIndex,
      scope: 'city',
    };
  }

  const points = SPC_POINTS[spcCategory] || 0;
  const notes: Record<string, string> = {
    'TSTM': 'General thunderstorm risk',
    'MRGL': 'Marginal severe risk',
    'SLGT': 'Slight severe risk',
    'ENH': 'Enhanced severe risk',
    'MDT': 'Moderate severe risk',
    'HIGH': 'High severe risk',
  };

  return {
    id: 'spc_outlook',
    label: 'SPC Convective Outlook',
    category: 'overlay',
    observed: spcCategory,
    points: round(Math.min(8.0, points), 2),
    notes: notes[spcCategory] || 'Severe risk',
    dayIndex,
    scope: 'city',
    meta: { spcCategory },
  };
}

/**
 * Factor: SPC Day 4-8 Convective Outlook (Days 4-8 only)
 * Max points: 4.0 (15% = SLGT +2.0, 30% = ENH +4.0)
 * Uses probabilistic outlook from NOAA ArcGIS MapServer
 */
function factorSPCDay48Overlay(
  spcDay48Category: string | undefined,
  spcDay48Dn: number | null | undefined,
  dayIndex: number
): RiskFactor {
  if (!spcDay48Category || dayIndex < 4 || dayIndex > 8) {
    return {
      id: 'spc_day48_outlook',
      label: 'SPC Day 4-8 Outlook',
      category: 'overlay',
      observed: (dayIndex < 4) ? 'N/A (Day 1-3)' : (dayIndex > 8) ? 'N/A (Day 9+)' : 'None',
      points: 0,
      notes: (dayIndex < 4) ? 'Day 4-8 outlook only valid Days 4-8' : 'No SPC D4-8 risk',
      dayIndex,
      scope: 'city',
    };
  }

  const points = SPC_DAY48_POINTS[spcDay48Category] || 0;
  const dnLabel = spcDay48Dn ? `${spcDay48Dn}%` : '';
  const notes: Record<string, string> = {
    'SLGT': `15% probability severe (${dnLabel} D4-8)`,
    'ENH': `30%+ probability severe (${dnLabel} D4-8)`,
  };

  // Display label shows the D4-8 designation
  const displayLabel = spcDay48Dn === 15 ? 'SLGT (D4-8)' :
                       spcDay48Dn === 30 ? 'ENH (D4-8)' :
                       `${spcDay48Category} (D4-8)`;

  return {
    id: 'spc_day48_outlook',
    label: 'SPC Day 4-8 Outlook',
    category: 'overlay',
    observed: displayLabel,
    points: round(Math.min(4.0, points), 2),
    notes: notes[spcDay48Category] || 'Severe risk (D4-8)',
    dayIndex,
    scope: 'city',
    meta: { spcDay48Category, spcDay48Dn },
  };
}

/**
 * Factor: WPC Excessive Rainfall Outlook (Days 1-5)
 * Max points: 4.5 (MRGL +0.4, SLGT +1.2, MDT +2.0, HIGH +4.5)
 */
function factorEROOverlay(
  eroCategory: string | undefined,
  dayIndex: number
): RiskFactor {
  if (!eroCategory || dayIndex > 5) {
    return {
      id: 'wpc_ero',
      label: 'WPC Excessive Rainfall Outlook',
      category: 'overlay',
      observed: dayIndex > 5 ? 'N/A (Day 6+)' : 'None',
      points: 0,
      notes: dayIndex > 5 ? 'ERO only valid Days 1-5' : 'No ERO risk',
      dayIndex,
      scope: 'city',
    };
  }

  const points = ERO_POINTS[eroCategory] || 0;
  const notes: Record<string, string> = {
    'MRGL': 'Marginal excessive rainfall risk',
    'SLGT': 'Slight excessive rainfall risk',
    'MDT': 'Moderate excessive rainfall risk',
    'HIGH': 'High excessive rainfall risk',
  };

  return {
    id: 'wpc_ero',
    label: 'WPC Excessive Rainfall Outlook',
    category: 'overlay',
    observed: eroCategory,
    points: round(Math.min(4.5, points), 2),
    notes: notes[eroCategory] || 'Excessive rainfall risk',
    dayIndex,
    scope: 'city',
    meta: { eroCategory },
  };
}

/**
 * Factor: WPC Winter Storm Severity Index (Days 1-3 only)
 * Max points: 5.5 (WWA +0.6, MINOR +1.4, MODERATE +2.6, MAJOR +4.0, EXTREME +5.5)
 * Cap at 6.0 to materially move score without dominating extreme SPC events
 */
function factorWSSIOverlay(
  wssiCategory: string | undefined,
  dayIndex: number
): RiskFactor {
  if (!wssiCategory || dayIndex > 3) {
    return {
      id: 'wpc_wssi',
      label: 'Winter Storm Severity Index',
      category: 'overlay',
      observed: dayIndex > 3 ? 'N/A (Day 4+)' : 'None',
      points: 0,
      notes: dayIndex > 3 ? 'WSSI only valid Days 1-3' : 'No WSSI risk',
      dayIndex,
      scope: 'city',
    };
  }

  const points = WSSI_POINTS[wssiCategory] || 0;
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
    id: 'wpc_wssi',
    label: 'Winter Storm Severity Index',
    category: 'overlay',
    observed: displayNames[wssiCategory] || wssiCategory,
    points: round(Math.min(6.0, points), 2),
    notes: notes[wssiCategory] || 'Winter storm impacts',
    dayIndex,
    scope: 'city',
    meta: { wssiCategory },
  };
}

// ============================================================================
// Summary Generation
// ============================================================================

function generateCitySummary(
  factors: RiskFactor[],
  score: number,
  dayIndex: number
): string {
  const topDrivers = deriveTopDrivers(factors);

  if (topDrivers.length === 0 || score < 1.5) {
    return 'No significant weather hazards expected.';
  }

  const sentences: string[] = [];
  const top = topDrivers[0];

  // Primary hazard description
  switch (top.id) {
    case 'snow_amount':
      if (top.meta?.snowIn >= 4) {
        sentences.push(`Heavy snow expected with ${(top.meta?.snowIn ?? 0).toFixed(1)}" accumulation.`);
      } else {
        sentences.push(`Snow accumulation of ${top.meta?.snowIn?.toFixed(1) || top.observed} expected.`);
      }
      break;
    case 'rain_amount':
      if (top.meta?.rainIn >= 1) {
        sentences.push(`Heavy rain expected with ${(top.meta?.rainIn ?? 0).toFixed(2)}".`);
      } else {
        sentences.push(`Rain expected with ${top.meta?.rainIn?.toFixed(2) || top.observed}.`);
      }
      break;
    case 'wind_gust':
      if (top.meta?.gustMph >= 50) {
        sentences.push(`High winds with gusts to ${Math.round((top.meta?.gustMph ?? 0))} mph.`);
      } else {
        sentences.push(`Windy conditions with gusts to ${Math.round(top.meta?.gustMph || 0)} mph.`);
      }
      break;
    case 'cold_intensity':
      if (top.meta?.tminF <= 0) {
        sentences.push(`Dangerously cold with lows near ${Math.round((top.meta?.tminF ?? 0))}°F.`);
      } else {
        sentences.push(`Cold conditions with lows near ${Math.round(top.meta?.tminF || 0)}°F.`);
      }
      break;
    case 'heat_intensity':
      if (top.meta?.tmaxF >= 100) {
        sentences.push(`Excessive heat with highs near ${Math.round((top.meta?.tmaxF ?? 0))}°F.`);
      } else {
        sentences.push(`Hot conditions with highs near ${Math.round(top.meta?.tmaxF || 0)}°F.`);
      }
      break;
    case 'ice_proxy':
      sentences.push('Ice accumulation possible with freezing rain.');
      break;
    case 'ice_accumulation':
      if (top.meta?.iceIn >= 0.5) {
        sentences.push(`Significant ice accumulation of ${(top.meta?.iceIn ?? 0).toFixed(2)}" expected.`);
      } else if (top.meta?.iceIn >= 0.25) {
        sentences.push(`Moderate ice accumulation of ${top.meta?.iceIn?.toFixed(2) || top.observed} expected.`);
      } else {
        sentences.push(`Light ice accumulation of ${top.meta?.iceIn?.toFixed(2) || top.observed} possible.`);
      }
      break;
    case 'spc_outlook':
      sentences.push(`Elevated severe weather risk (${top.meta?.spcCategory}).`);
      break;
    case 'spc_day48_outlook':
      sentences.push(`Elevated severe weather risk for Day ${dayIndex} (${top.observed}).`);
      break;
    case 'wpc_ero':
      sentences.push(`Elevated flooding risk (${top.meta?.eroCategory}).`);
      break;
    case 'wpc_wssi':
      sentences.push(`Winter storm impacts expected (${top.observed}).`);
      break;
    case 'winter_travel':
      sentences.push('Winter travel impacts expected.');
      break;
    default:
      sentences.push(`Primary concern: ${top.notes || top.label}.`);
  }

  // Secondary hazard
  if (topDrivers.length >= 2 && topDrivers[1].points >= 0.5) {
    const secondary = topDrivers[1];
    if (secondary.id === 'wind_gust' && secondary.meta?.gustMph >= 25) {
      sentences.push('Strong winds will compound impacts.');
    } else if (secondary.id === 'winter_travel') {
      sentences.push('Travel may be hazardous.');
    } else if (secondary.id === 'cold_intensity') {
      sentences.push('Cold temperatures add to concerns.');
    }
  }

  // Extended forecast note
  if (dayIndex >= 6) {
    sentences.push('Extended forecast confidence is lower.');
  }

  return sentences.join(' ');
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Compute city risk score for a specific day with full factor breakdown
 *
 * @param dayIndex - 1-7 (Day 1 = today)
 * @param cityForecast - Weather metrics for the city/day
 * @param overlays - SPC/ERO overlay categories if applicable
 * @param regionId - Region identifier for regional multipliers (e.g., 'southeast', 'midwest')
 * @returns RiskScoreResult with factors, score, and explainer
 */
export function computeCityRisk(
  dayIndex: number,
  cityForecast: CityDayInput,
  overlays?: CityOverlays,
  regionId?: string
): RiskScoreResult {
  const factors: RiskFactor[] = [];
  const dayIdx = Math.max(1, Math.min(7, dayIndex));

  // ===== SNOW FACTORS =====
  factors.push(factorSnowAmount(cityForecast.snow_in, dayIdx));
  factors.push(factorSnowRate(cityForecast.snow_in, cityForecast.hourlySnow, dayIdx));

  // ===== RAIN FACTORS =====
  factors.push(factorRainAmount(cityForecast.rain_in, dayIdx));
  factors.push(factorRainIntensity(cityForecast.rain_in, cityForecast.hourlyPrecip, dayIdx));

  // ===== WIND FACTOR =====
  factors.push(factorWindGust(cityForecast.wind_gust_mph, dayIdx));

  // ===== TEMPERATURE FACTORS =====
  factors.push(factorColdIntensity(cityForecast.tmin_f, dayIdx));
  factors.push(factorHeatIntensity(cityForecast.tmax_f, dayIdx));

  // ===== ICE FACTORS =====
  // Inferred ice from temperature/rain (legacy proxy)
  factors.push(factorIceProxy(
    cityForecast.rain_in,
    cityForecast.tmin_f,
    cityForecast.tmax_f,
    cityForecast.hourlyTemp,
    dayIdx
  ));
  // NBM FRAM ice accumulation (authoritative NWS data)
  // Regional multiplier applied for southern regions with less ice infrastructure
  factors.push(factorIceAccumulation(cityForecast.ice_in, dayIdx, regionId));

  // ===== TRAVEL FACTOR =====
  factors.push(factorWinterTravel(
    cityForecast.snow_in,
    cityForecast.wind_gust_mph,
    cityForecast.tmin_f,
    dayIdx
  ));

  // ===== SYNERGY FACTOR (computed from other factors) =====
  factors.push(factorMultiHazardSynergy(factors, dayIdx));

  // ===== OVERLAY FACTORS =====
  // Day 1-3: SPC, ERO, WSSI
  factors.push(factorSPCOverlay(overlays?.spcCategory, dayIdx));
  factors.push(factorEROOverlay(overlays?.eroCategory, dayIdx));
  factors.push(factorWSSIOverlay(overlays?.wssiCategory, dayIdx));
  // Day 4-8: SPC Day 4-8 probabilistic outlook
  factors.push(factorSPCDay48Overlay(overlays?.spcDay48Category, overlays?.spcDay48Dn, dayIdx));

  // ===== CAP COMBINED COLD CONTRIBUTION =====
  // Cold alone shouldn't dominate when no precip
  const coldFactor = factors.find(f => f.id === 'cold_intensity');
  const snowFactor = factors.find(f => f.id === 'snow_amount');
  const rainFactor = factors.find(f => f.id === 'rain_amount');
  const iceProxyFactor = factors.find(f => f.id === 'ice_proxy');
  const iceNbmFactor = factors.find(f => f.id === 'ice_accumulation');

  if (coldFactor && coldFactor.points > 1.5) {
    const hasPrecip = (snowFactor?.points || 0) > 0.2 ||
                      (rainFactor?.points || 0) > 0.2 ||
                      (iceProxyFactor?.points || 0) > 0.3 ||
                      (iceNbmFactor?.points || 0) > 0.3;
    if (!hasPrecip) {
      // Cap cold at 1.5 when no meaningful precip
      coldFactor.points = Math.min(1.5, coldFactor.points);
    }
  }

  // ===== SUM ALL FACTORS =====
  let rawScore = factors.reduce((sum, f) => sum + f.points, 0);

  // Apply day damping for extended forecasts
  rawScore = applyDayDamping(rawScore, dayIdx);

  // Clamp to 0-10
  rawScore = clamp(rawScore, 0, 10);

  // ===== BUILD RESULT =====
  const topDrivers = deriveTopDrivers(factors);
  const summary = generateCitySummary(factors, rawScore, dayIdx);

  return {
    score_raw: round(rawScore, 2),
    score_display: round(rawScore, 1),
    level: scoreToLevel(rawScore),
    factors,
    top_drivers: topDrivers,
    summary,
  };
}
