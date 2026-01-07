// Wind Shear and Helicity Calculations
// Implements bulk shear, storm-relative helicity, and storm motion estimates

import { SoundingLevel, DerivedParameters } from './types';
import { knotsToMs, msToKnots } from './thermo';

// Convert wind direction/speed to u/v components
// u = east-west component (positive = from west)
// v = north-south component (positive = from south)
export function windToComponents(
  dirDeg: number,
  speedKt: number
): { u: number; v: number } {
  const dirRad = (dirDeg * Math.PI) / 180;
  // Meteorological convention: direction is where wind comes FROM
  const u = -speedKt * Math.sin(dirRad);
  const v = -speedKt * Math.cos(dirRad);
  return { u, v };
}

// Convert u/v components back to direction/speed
export function componentsToWind(u: number, v: number): { dir: number; speed: number } {
  const speed = Math.sqrt(u * u + v * v);
  if (speed < 0.01) return { dir: 0, speed: 0 };

  let dir = (Math.atan2(-u, -v) * 180) / Math.PI;
  if (dir < 0) dir += 360;

  return { dir, speed };
}

// Interpolate wind at a specific height (meters AGL)
function interpolateWindAtHeight(
  levels: SoundingLevel[],
  targetHeightM: number,
  surfaceHeightM: number
): { u: number; v: number } | null {
  // Convert to AGL if levels are in MSL
  const targetMSL = targetHeightM + surfaceHeightM;

  const sorted = [...levels].sort((a, b) => a.height_m - b.height_m);

  for (let i = 0; i < sorted.length - 1; i++) {
    const below = sorted[i];
    const above = sorted[i + 1];

    if (targetMSL >= below.height_m && targetMSL <= above.height_m) {
      const frac = (targetMSL - below.height_m) / (above.height_m - below.height_m);

      const wind1 = windToComponents(below.wind_dir_deg, below.wind_speed_kt);
      const wind2 = windToComponents(above.wind_dir_deg, above.wind_speed_kt);

      return {
        u: wind1.u + frac * (wind2.u - wind1.u),
        v: wind1.v + frac * (wind2.v - wind1.v),
      };
    }
  }

  return null;
}

// Calculate bulk wind difference (shear magnitude) between two heights
export function bulkShear(
  levels: SoundingLevel[],
  bottomM: number,
  topM: number,
  surfaceHeightM: number
): { magnitude: number; u: number; v: number } {
  const windBottom = interpolateWindAtHeight(levels, bottomM, surfaceHeightM);
  const windTop = interpolateWindAtHeight(levels, topM, surfaceHeightM);

  if (!windBottom || !windTop) {
    return { magnitude: 0, u: 0, v: 0 };
  }

  const du = windTop.u - windBottom.u;
  const dv = windTop.v - windBottom.v;
  const magnitude = Math.sqrt(du * du + dv * dv);

  return { magnitude, u: du, v: dv };
}

// Mean wind in a layer
export function meanWind(
  levels: SoundingLevel[],
  bottomM: number,
  topM: number,
  surfaceHeightM: number,
  stepM: number = 250
): { u: number; v: number } {
  let sumU = 0;
  let sumV = 0;
  let count = 0;

  for (let h = bottomM; h <= topM; h += stepM) {
    const wind = interpolateWindAtHeight(levels, h, surfaceHeightM);
    if (wind) {
      sumU += wind.u;
      sumV += wind.v;
      count++;
    }
  }

  if (count === 0) return { u: 0, v: 0 };

  return { u: sumU / count, v: sumV / count };
}

// Bunkers Storm Motion estimate
// Returns right-moving, left-moving, and mean wind motion
export function bunkersStormMotion(
  levels: SoundingLevel[],
  surfaceHeightM: number
): {
  right: { u: number; v: number; dir: number; speed: number };
  left: { u: number; v: number; dir: number; speed: number };
  mean: { u: number; v: number; dir: number; speed: number };
} {
  // Bunkers method uses 0-6km mean wind and 0-6km shear
  const meanWindVec = meanWind(levels, 0, 6000, surfaceHeightM);
  const shear = bulkShear(levels, 0, 6000, surfaceHeightM);

  // Deviation from mean wind: 7.5 m/s perpendicular to shear vector
  const deviationMagnitude = 7.5; // m/s, convert to knots
  const deviationKt = msToKnots(deviationMagnitude);

  // Normalize shear vector
  const shearMag = Math.sqrt(shear.u * shear.u + shear.v * shear.v);
  if (shearMag < 0.01) {
    // No shear, just return mean wind
    const mean = componentsToWind(meanWindVec.u, meanWindVec.v);
    return {
      right: { u: meanWindVec.u, v: meanWindVec.v, ...mean },
      left: { u: meanWindVec.u, v: meanWindVec.v, ...mean },
      mean: { u: meanWindVec.u, v: meanWindVec.v, ...mean },
    };
  }

  const shearUnitU = shear.u / shearMag;
  const shearUnitV = shear.v / shearMag;

  // Perpendicular vectors (90° rotation)
  // Right-mover: to the right of shear vector (clockwise)
  const rightPerpU = shearUnitV * deviationKt;
  const rightPerpV = -shearUnitU * deviationKt;

  // Left-mover: to the left of shear vector (counter-clockwise)
  const leftPerpU = -shearUnitV * deviationKt;
  const leftPerpV = shearUnitU * deviationKt;

  const rightU = meanWindVec.u + rightPerpU;
  const rightV = meanWindVec.v + rightPerpV;
  const leftU = meanWindVec.u + leftPerpU;
  const leftV = meanWindVec.v + leftPerpV;

  const rightWind = componentsToWind(rightU, rightV);
  const leftWind = componentsToWind(leftU, leftV);
  const meanWindResult = componentsToWind(meanWindVec.u, meanWindVec.v);

  return {
    right: { u: rightU, v: rightV, ...rightWind },
    left: { u: leftU, v: leftV, ...leftWind },
    mean: { u: meanWindVec.u, v: meanWindVec.v, ...meanWindResult },
  };
}

// Storm-Relative Helicity (SRH)
// SRH = integral of (V - C) · (dV/dz × k) dz
// Where V is wind vector, C is storm motion, k is unit vertical vector
export function stormRelativeHelicity(
  levels: SoundingLevel[],
  bottomM: number,
  topM: number,
  surfaceHeightM: number,
  stormMotion: { u: number; v: number }
): number {
  const sorted = [...levels].sort((a, b) => a.height_m - b.height_m);

  let srh = 0;

  // Convert storm motion to m/s for consistent units
  const stormU = knotsToMs(stormMotion.u);
  const stormV = knotsToMs(stormMotion.v);

  for (let i = 0; i < sorted.length - 1; i++) {
    const level1 = sorted[i];
    const level2 = sorted[i + 1];

    const h1 = level1.height_m - surfaceHeightM; // AGL
    const h2 = level2.height_m - surfaceHeightM;

    // Check if this layer is within our target range
    if (h2 < bottomM || h1 > topM) continue;

    // Clip to range
    const layerBottom = Math.max(h1, bottomM);
    const layerTop = Math.min(h2, topM);

    // Get winds at layer boundaries in m/s
    const wind1 = windToComponents(level1.wind_dir_deg, level1.wind_speed_kt);
    const wind2 = windToComponents(level2.wind_dir_deg, level2.wind_speed_kt);

    const u1 = knotsToMs(wind1.u);
    const v1 = knotsToMs(wind1.v);
    const u2 = knotsToMs(wind2.u);
    const v2 = knotsToMs(wind2.v);

    // Storm-relative winds
    const sru1 = u1 - stormU;
    const srv1 = v1 - stormV;
    const sru2 = u2 - stormU;
    const srv2 = v2 - stormV;

    // Helicity contribution: (u2 - u1)(srv1 + srv2)/2 - (v2 - v1)(sru1 + sru2)/2
    // Simplified form of the SRH integral
    const du = u2 - u1;
    const dv = v2 - v1;
    const srvMean = (srv1 + srv2) / 2;
    const sruMean = (sru1 + sru2) / 2;

    const layerSRH = du * srvMean - dv * sruMean;
    srh += layerSRH;
  }

  return srh;
}

// Critical angle between 0-500m shear and storm motion
export function criticalAngle(
  shearU: number,
  shearV: number,
  stormMotionU: number,
  stormMotionV: number
): number {
  const shearMag = Math.sqrt(shearU * shearU + shearV * shearV);
  const stormMag = Math.sqrt(stormMotionU * stormMotionU + stormMotionV * stormMotionV);

  if (shearMag < 0.01 || stormMag < 0.01) return 0;

  const dot = shearU * stormMotionU + shearV * stormMotionV;
  const cosAngle = dot / (shearMag * stormMag);

  // Clamp to valid range for acos
  const clampedCos = Math.max(-1, Math.min(1, cosAngle));
  const angleRad = Math.acos(clampedCos);

  return (angleRad * 180) / Math.PI;
}

// Energy-Helicity Index (EHI)
export function energyHelicityIndex(cape: number, srh: number): number {
  return (cape * srh) / 160000;
}

// Significant Tornado Parameter (STP)
// STP = (MLCAPE/1500) * (MLLCL/1000) * (0-1km SRH/150) * (0-6km shear/20) * ((2000-MLLCL)/1000)
export function significantTornadoParameter(
  mlcape: number,
  mlcin: number,
  mllcl_m: number,
  srh_0_1km: number,
  shear_0_6km: number
): number {
  // Component terms with limits
  const capeTerm = Math.min(mlcape / 1500, 2);
  const lclTerm = mllcl_m < 2000 ? (2000 - mllcl_m) / 1000 : 0;
  const srhTerm = srh_0_1km / 150;
  const shearTerm = shear_0_6km > 12.5 ? Math.min(shear_0_6km / 20, 1.5) : 0;

  // CIN penalty
  let cinTerm = 1;
  if (mlcin < -40 && mlcin > -200) {
    cinTerm = (200 + mlcin) / 160;
  } else if (mlcin <= -200) {
    cinTerm = 0;
  }

  return capeTerm * lclTerm * srhTerm * shearTerm * cinTerm;
}

// Supercell Composite Parameter (SCP)
export function supercellCompositeParameter(
  mucape: number,
  srh_0_3km: number,
  shear_0_6km: number
): number {
  const capeTerm = mucape / 1000;
  const srhTerm = srh_0_3km / 50;
  const shearTerm = shear_0_6km > 10 ? shear_0_6km / 20 : 0;

  return capeTerm * srhTerm * shearTerm;
}

// Significant Hail Parameter (SHIP)
export function significantHailParameter(
  mucape: number,
  mixingRatio_gkg: number,
  lapsRate_700_500: number, // degrees C per km
  t500: number,
  shear_0_6km: number
): number {
  const capeTerm = mucape;
  const moistTerm = mixingRatio_gkg;
  const lapseTerm = lapsRate_700_500;
  const tempTerm = -t500;
  const shearTerm = shear_0_6km;

  const ship = (capeTerm * moistTerm * lapseTerm * tempTerm * shearTerm) / 42000000;
  return Math.max(0, ship);
}

// Compute all shear-related parameters
export function computeShearParameters(
  levels: SoundingLevel[],
  surfaceHeightM: number
): Partial<DerivedParameters> {
  // Bulk shear at various levels
  const shear_0_500m = bulkShear(levels, 0, 500, surfaceHeightM);
  const shear_0_1km = bulkShear(levels, 0, 1000, surfaceHeightM);
  const shear_0_3km = bulkShear(levels, 0, 3000, surfaceHeightM);
  const shear_0_6km = bulkShear(levels, 0, 6000, surfaceHeightM);
  const shear_0_8km = bulkShear(levels, 0, 8000, surfaceHeightM);

  // Storm motion estimate
  const stormMotion = bunkersStormMotion(levels, surfaceHeightM);

  // Storm-Relative Helicity
  const srh_0_500m = stormRelativeHelicity(levels, 0, 500, surfaceHeightM, stormMotion.right);
  const srh_0_1km = stormRelativeHelicity(levels, 0, 1000, surfaceHeightM, stormMotion.right);
  const srh_0_3km = stormRelativeHelicity(levels, 0, 3000, surfaceHeightM, stormMotion.right);

  // Critical angle
  const critAngle = criticalAngle(
    shear_0_500m.u,
    shear_0_500m.v,
    stormMotion.right.u,
    stormMotion.right.v
  );

  return {
    shear_0_500m: shear_0_500m.magnitude,
    shear_0_1km: shear_0_1km.magnitude,
    shear_0_3km: shear_0_3km.magnitude,
    shear_0_6km: shear_0_6km.magnitude,
    shear_0_8km: shear_0_8km.magnitude,
    shear_0_1km_u: shear_0_1km.u,
    shear_0_1km_v: shear_0_1km.v,
    shear_0_6km_u: shear_0_6km.u,
    shear_0_6km_v: shear_0_6km.v,
    srh_0_500m,
    srh_0_1km,
    srh_0_3km,
    storm_motion_right_dir: stormMotion.right.dir,
    storm_motion_right_spd: stormMotion.right.speed,
    storm_motion_left_dir: stormMotion.left.dir,
    storm_motion_left_spd: stormMotion.left.speed,
    storm_motion_mean_dir: stormMotion.mean.dir,
    storm_motion_mean_spd: stormMotion.mean.speed,
    critical_angle: critAngle,
  };
}
