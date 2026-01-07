// Compute all derived parameters from a sounding

import { Sounding, SoundingLevel, DerivedParameters } from './types';
import {
  precipitableWater,
  findIsothermHeight,
  wetBulbTemperature,
  relativeHumidity,
  kIndex,
  totalTotals,
  sweatIndex,
  liftedIndex,
} from './thermo';
import { computeParcelParameters } from './parcel';
import {
  computeShearParameters,
  significantTornadoParameter,
  supercellCompositeParameter,
  significantHailParameter,
  energyHelicityIndex,
} from './shear';

// Interpolate to find temperature at a specific pressure level
function interpTempAtPressure(
  levels: SoundingLevel[],
  targetPressure: number
): number | null {
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);

  for (let i = 0; i < sorted.length - 1; i++) {
    const below = sorted[i];
    const above = sorted[i + 1];

    if (targetPressure <= below.pressure_mb && targetPressure >= above.pressure_mb) {
      const logP = Math.log(targetPressure);
      const logP1 = Math.log(below.pressure_mb);
      const logP2 = Math.log(above.pressure_mb);
      const frac = (logP - logP1) / (logP2 - logP1);
      return below.temp_c + frac * (above.temp_c - below.temp_c);
    }
  }

  return null;
}

// Interpolate dewpoint at a specific pressure level
function interpDewpointAtPressure(
  levels: SoundingLevel[],
  targetPressure: number
): number | null {
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);

  for (let i = 0; i < sorted.length - 1; i++) {
    const below = sorted[i];
    const above = sorted[i + 1];

    if (targetPressure <= below.pressure_mb && targetPressure >= above.pressure_mb) {
      const logP = Math.log(targetPressure);
      const logP1 = Math.log(below.pressure_mb);
      const logP2 = Math.log(above.pressure_mb);
      const frac = (logP - logP1) / (logP2 - logP1);
      return below.dewpoint_c + frac * (above.dewpoint_c - below.dewpoint_c);
    }
  }

  return null;
}

// Interpolate wind at a specific pressure level
function interpWindAtPressure(
  levels: SoundingLevel[],
  targetPressure: number
): { dir: number; speed: number } | null {
  const sorted = [...levels].sort((a, b) => b.pressure_mb - a.pressure_mb);

  for (let i = 0; i < sorted.length - 1; i++) {
    const below = sorted[i];
    const above = sorted[i + 1];

    if (targetPressure <= below.pressure_mb && targetPressure >= above.pressure_mb) {
      const logP = Math.log(targetPressure);
      const logP1 = Math.log(below.pressure_mb);
      const logP2 = Math.log(above.pressure_mb);
      const frac = (logP - logP1) / (logP2 - logP1);

      // Interpolate wind components
      const dir1Rad = (below.wind_dir_deg * Math.PI) / 180;
      const dir2Rad = (above.wind_dir_deg * Math.PI) / 180;

      const u1 = -below.wind_speed_kt * Math.sin(dir1Rad);
      const v1 = -below.wind_speed_kt * Math.cos(dir1Rad);
      const u2 = -above.wind_speed_kt * Math.sin(dir2Rad);
      const v2 = -above.wind_speed_kt * Math.cos(dir2Rad);

      const u = u1 + frac * (u2 - u1);
      const v = v1 + frac * (v2 - v1);

      const speed = Math.sqrt(u * u + v * v);
      let dir = (Math.atan2(-u, -v) * 180) / Math.PI;
      if (dir < 0) dir += 360;

      return { dir, speed };
    }
  }

  return null;
}

// Compute mean RH in a layer
function meanRHInLayer(
  levels: SoundingLevel[],
  bottomM: number,
  topM: number,
  surfaceHeightM: number
): number {
  const sorted = [...levels].sort((a, b) => a.height_m - b.height_m);

  let sumRH = 0;
  let count = 0;

  for (const level of sorted) {
    const heightAGL = level.height_m - surfaceHeightM;
    if (heightAGL >= bottomM && heightAGL <= topM) {
      const rh = level.rh ?? relativeHumidity(level.temp_c, level.dewpoint_c);
      if (!isNaN(rh)) {
        sumRH += rh;
        count++;
      }
    }
  }

  return count > 0 ? sumRH / count : 0;
}

// Compute lapse rate between two pressure levels (C/km)
function lapseRate(
  levels: SoundingLevel[],
  bottomPressure: number,
  topPressure: number
): number {
  const t1 = interpTempAtPressure(levels, bottomPressure);
  const t2 = interpTempAtPressure(levels, topPressure);

  if (t1 === null || t2 === null) return 0;

  // Estimate height difference (rough approximation)
  // Using hypsometric equation with average temp
  const avgT = ((t1 + t2) / 2 + 273.15);
  const Rd = 287.05;
  const g = 9.80665;
  const dz = (Rd * avgT / g) * Math.log(bottomPressure / topPressure);

  return ((t1 - t2) / dz) * 1000; // C/km
}

// Main function to compute all derived parameters
export function computeDerivedParameters(sounding: Sounding): DerivedParameters {
  const levels = sounding.levels.filter(
    l => !isNaN(l.temp_c) && !isNaN(l.dewpoint_c)
  );

  if (levels.length < 5) {
    // Not enough data for meaningful analysis
    return createEmptyDerivedParams(sounding.station_id, sounding.obs_time);
  }

  const surfaceLevel = levels.reduce((a, b) =>
    a.pressure_mb > b.pressure_mb ? a : b
  );
  const surfaceHeightM = surfaceLevel.height_m;

  // Get temperatures at standard levels
  const t850 = interpTempAtPressure(levels, 850) ?? 0;
  const t700 = interpTempAtPressure(levels, 700) ?? 0;
  const t500 = interpTempAtPressure(levels, 500) ?? 0;
  const td850 = interpDewpointAtPressure(levels, 850) ?? 0;
  const td700 = interpDewpointAtPressure(levels, 700) ?? 0;

  // Get winds at standard levels
  const wind850 = interpWindAtPressure(levels, 850) ?? { dir: 0, speed: 0 };
  const wind500 = interpWindAtPressure(levels, 500) ?? { dir: 0, speed: 0 };

  // Parcel-based parameters (CAPE, CIN, LCL, LFC, EL)
  const parcelParams = computeParcelParameters(levels);

  // Shear-based parameters
  const shearParams = computeShearParameters(levels, surfaceHeightM);

  // Precipitable water
  const pwat_mm = precipitableWater(
    levels.map(l => ({ pressure_mb: l.pressure_mb, dewpoint_c: l.dewpoint_c }))
  );

  // Find isotherm heights
  const t_0c_height = findIsothermHeight(
    levels.map(l => ({ height_m: l.height_m - surfaceHeightM, temp_c: l.temp_c })),
    0
  ) ?? 0;

  const t_minus10c_height = findIsothermHeight(
    levels.map(l => ({ height_m: l.height_m - surfaceHeightM, temp_c: l.temp_c })),
    -10
  ) ?? 0;

  const t_minus20c_height = findIsothermHeight(
    levels.map(l => ({ height_m: l.height_m - surfaceHeightM, temp_c: l.temp_c })),
    -20
  ) ?? 0;

  // Wet bulb zero height
  const wetBulbLevels = levels.map(l => {
    const rh = l.rh ?? relativeHumidity(l.temp_c, l.dewpoint_c);
    return {
      height_m: l.height_m - surfaceHeightM,
      temp_c: wetBulbTemperature(l.temp_c, rh),
    };
  });
  const wet_bulb_zero = findIsothermHeight(wetBulbLevels, 0) ?? 0;

  // Mean RH 0-6km
  const mean_rh_0_6km = meanRHInLayer(levels, 0, 6000, surfaceHeightM);

  // Classic indices
  const k = kIndex(t850, t700, t500, td850, td700);
  const tt = totalTotals(t850, t500, td850);
  const sweat = sweatIndex(t850, td850, t500, wind850.dir, wind850.speed, wind500.dir, wind500.speed);

  // Lifted index
  const li = liftedIndex(
    surfaceLevel.temp_c,
    surfaceLevel.dewpoint_c,
    surfaceLevel.pressure_mb,
    t500
  );

  // LI to 700mb
  const li_700 = liftedIndex(
    surfaceLevel.temp_c,
    surfaceLevel.dewpoint_c,
    surfaceLevel.pressure_mb,
    t700
  );

  // Composite indices
  const stp = significantTornadoParameter(
    parcelParams.mlcape ?? 0,
    parcelParams.mlcin ?? 0,
    parcelParams.lcl_m ?? 0,
    shearParams.srh_0_1km ?? 0,
    shearParams.shear_0_6km ?? 0
  );

  const scp = supercellCompositeParameter(
    parcelParams.mucape ?? 0,
    shearParams.srh_0_3km ?? 0,
    shearParams.shear_0_6km ?? 0
  );

  // SHIP (need mixing ratio at 850 and lapse rate 700-500)
  const mixRatio850 = 10; // Placeholder - would need actual calculation
  const lapse_700_500 = lapseRate(levels, 700, 500);
  const ship = significantHailParameter(
    parcelParams.mucape ?? 0,
    mixRatio850,
    lapse_700_500,
    t500,
    shearParams.shear_0_6km ?? 0
  );

  // EHI
  const ehi_0_1km = energyHelicityIndex(parcelParams.mlcape ?? 0, shearParams.srh_0_1km ?? 0);
  const ehi_0_3km = energyHelicityIndex(parcelParams.mlcape ?? 0, shearParams.srh_0_3km ?? 0);

  return {
    station_id: sounding.station_id,
    obs_time: sounding.obs_time,

    // Instability
    cape_jkg: parcelParams.cape_jkg ?? 0,
    cin_jkg: parcelParams.cin_jkg ?? 0,
    sbcape: parcelParams.sbcape ?? 0,
    sbcin: parcelParams.sbcin ?? 0,
    mlcape: parcelParams.mlcape ?? 0,
    mlcin: parcelParams.mlcin ?? 0,
    mucape: parcelParams.mucape ?? 0,
    mucin: parcelParams.mucin ?? 0,

    // Lifted indices
    li,
    li_700,

    // Moisture
    pwat_mm,
    pwat_in: pwat_mm / 25.4,
    mean_rh_0_6km,

    // Significant levels
    lcl_m: parcelParams.lcl_m ?? 0,
    lcl_pressure_mb: parcelParams.lcl_pressure_mb ?? 0,
    lfc_m: parcelParams.lfc_m ?? 0,
    lfc_pressure_mb: parcelParams.lfc_pressure_mb ?? 0,
    el_m: parcelParams.el_m ?? 0,
    el_pressure_mb: parcelParams.el_pressure_mb ?? 0,

    // Temperature levels
    t_0c_height_m: t_0c_height,
    t_minus10c_height_m: t_minus10c_height,
    t_minus20c_height_m: t_minus20c_height,
    wet_bulb_zero_m: wet_bulb_zero,

    // Shear
    shear_0_500m: shearParams.shear_0_500m ?? 0,
    shear_0_1km: shearParams.shear_0_1km ?? 0,
    shear_0_3km: shearParams.shear_0_3km ?? 0,
    shear_0_6km: shearParams.shear_0_6km ?? 0,
    shear_0_8km: shearParams.shear_0_8km ?? 0,
    shear_0_1km_u: shearParams.shear_0_1km_u ?? 0,
    shear_0_1km_v: shearParams.shear_0_1km_v ?? 0,
    shear_0_6km_u: shearParams.shear_0_6km_u ?? 0,
    shear_0_6km_v: shearParams.shear_0_6km_v ?? 0,

    // Helicity
    srh_0_500m: shearParams.srh_0_500m ?? 0,
    srh_0_1km: shearParams.srh_0_1km ?? 0,
    srh_0_3km: shearParams.srh_0_3km ?? 0,

    // Storm motion
    storm_motion_right_dir: shearParams.storm_motion_right_dir ?? 0,
    storm_motion_right_spd: shearParams.storm_motion_right_spd ?? 0,
    storm_motion_left_dir: shearParams.storm_motion_left_dir ?? 0,
    storm_motion_left_spd: shearParams.storm_motion_left_spd ?? 0,
    storm_motion_mean_dir: shearParams.storm_motion_mean_dir ?? 0,
    storm_motion_mean_spd: shearParams.storm_motion_mean_spd ?? 0,

    // Composite indices
    stp,
    scp,
    ship,
    ehi_0_1km,
    ehi_0_3km,

    // Classic indices
    k_index: k,
    totals_totals: tt,
    sweat_index: sweat,

    // DCAPE
    dcape: parcelParams.dcape,

    // Critical angle
    critical_angle: shearParams.critical_angle,
  };
}

function createEmptyDerivedParams(stationId: string, obsTime: string): DerivedParameters {
  return {
    station_id: stationId,
    obs_time: obsTime,
    cape_jkg: 0,
    cin_jkg: 0,
    sbcape: 0,
    sbcin: 0,
    mlcape: 0,
    mlcin: 0,
    mucape: 0,
    mucin: 0,
    li: 0,
    li_700: 0,
    pwat_mm: 0,
    pwat_in: 0,
    mean_rh_0_6km: 0,
    lcl_m: 0,
    lcl_pressure_mb: 0,
    lfc_m: 0,
    lfc_pressure_mb: 0,
    el_m: 0,
    el_pressure_mb: 0,
    t_0c_height_m: 0,
    t_minus10c_height_m: 0,
    t_minus20c_height_m: 0,
    wet_bulb_zero_m: 0,
    shear_0_500m: 0,
    shear_0_1km: 0,
    shear_0_3km: 0,
    shear_0_6km: 0,
    shear_0_8km: 0,
    shear_0_1km_u: 0,
    shear_0_1km_v: 0,
    shear_0_6km_u: 0,
    shear_0_6km_v: 0,
    srh_0_500m: 0,
    srh_0_1km: 0,
    srh_0_3km: 0,
    storm_motion_right_dir: 0,
    storm_motion_right_spd: 0,
    storm_motion_left_dir: 0,
    storm_motion_left_spd: 0,
    storm_motion_mean_dir: 0,
    storm_motion_mean_spd: 0,
    stp: 0,
    scp: 0,
    ship: 0,
    ehi_0_1km: 0,
    ehi_0_3km: 0,
    k_index: 0,
    totals_totals: 0,
    sweat_index: 0,
    dcape: 0,
    critical_angle: 0,
  };
}
