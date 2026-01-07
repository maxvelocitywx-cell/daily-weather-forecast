'use client';

import { DerivedParameters } from '@/lib/soundings/types';

interface DerivedParamsCardProps {
  derived: DerivedParameters;
}

export function DerivedParamsCard({ derived }: DerivedParamsCardProps) {
  return (
    <div className="space-y-4">
      {/* Thermodynamic Parameters */}
      <div className="bg-mv-bg-tertiary rounded-xl p-4">
        <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
          Thermodynamic Parameters
        </h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <ParamItem label="SBCAPE" value={derived.sbcape} unit="J/kg" threshold={1000} />
          <ParamItem label="MLCAPE" value={derived.mlcape} unit="J/kg" threshold={1000} />
          <ParamItem label="MUCAPE" value={derived.mucape} unit="J/kg" threshold={1000} />
          <ParamItem label="SBCIN" value={derived.sbcin} unit="J/kg" inverse />
          <ParamItem label="MLCIN" value={derived.mlcin} unit="J/kg" inverse />
          <ParamItem label="LI" value={derived.li} decimals={1} inverse />
          <ParamItem label="LCL" value={derived.lcl_m} unit="m" />
          <ParamItem label="LFC" value={derived.lfc_m} unit="m" />
          <ParamItem label="EL" value={derived.el_m} unit="m" />
        </div>
      </div>

      {/* Moisture Parameters */}
      <div className="bg-mv-bg-tertiary rounded-xl p-4">
        <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
          Moisture
        </h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <ParamItem label="PWAT" value={derived.pwat_in} unit="in" decimals={2} />
          <ParamItem label="Mean RH 0-6km" value={derived.mean_rh_0_6km} unit="%" decimals={0} />
          <ParamItem label="WBZ" value={derived.wet_bulb_zero_m} unit="m" />
        </div>
      </div>

      {/* Temperature Levels */}
      <div className="bg-mv-bg-tertiary rounded-xl p-4">
        <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
          Temperature Levels (AGL)
        </h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <ParamItem label="0°C" value={derived.t_0c_height_m} unit="m" />
          <ParamItem label="-10°C" value={derived.t_minus10c_height_m} unit="m" />
          <ParamItem label="-20°C" value={derived.t_minus20c_height_m} unit="m" />
        </div>
      </div>

      {/* Wind Shear */}
      <div className="bg-mv-bg-tertiary rounded-xl p-4">
        <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
          Wind Shear
        </h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <ParamItem label="0-500m" value={derived.shear_0_500m} unit="kt" threshold={15} />
          <ParamItem label="0-1km" value={derived.shear_0_1km} unit="kt" threshold={20} />
          <ParamItem label="0-3km" value={derived.shear_0_3km} unit="kt" threshold={30} />
          <ParamItem label="0-6km" value={derived.shear_0_6km} unit="kt" threshold={40} />
          <ParamItem label="0-8km" value={derived.shear_0_8km} unit="kt" threshold={50} />
        </div>
      </div>

      {/* Storm-Relative Helicity */}
      <div className="bg-mv-bg-tertiary rounded-xl p-4">
        <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
          Storm-Relative Helicity
        </h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <ParamItem label="0-500m SRH" value={derived.srh_0_500m} unit="m²/s²" threshold={100} />
          <ParamItem label="0-1km SRH" value={derived.srh_0_1km} unit="m²/s²" threshold={150} />
          <ParamItem label="0-3km SRH" value={derived.srh_0_3km} unit="m²/s²" threshold={200} />
        </div>
      </div>

      {/* Storm Motion */}
      <div className="bg-mv-bg-tertiary rounded-xl p-4">
        <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
          Storm Motion (Bunkers)
        </h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="bg-mv-bg-secondary rounded-lg p-2">
            <span className="text-mv-text-muted block text-xs">Right Mover</span>
            <span className="text-mv-text-primary font-medium">
              {Math.round(derived.storm_motion_right_dir)}° / {Math.round(derived.storm_motion_right_spd)} kt
            </span>
          </div>
          <div className="bg-mv-bg-secondary rounded-lg p-2">
            <span className="text-mv-text-muted block text-xs">Left Mover</span>
            <span className="text-mv-text-primary font-medium">
              {Math.round(derived.storm_motion_left_dir)}° / {Math.round(derived.storm_motion_left_spd)} kt
            </span>
          </div>
          <div className="bg-mv-bg-secondary rounded-lg p-2">
            <span className="text-mv-text-muted block text-xs">Mean Wind</span>
            <span className="text-mv-text-primary font-medium">
              {Math.round(derived.storm_motion_mean_dir)}° / {Math.round(derived.storm_motion_mean_spd)} kt
            </span>
          </div>
        </div>
      </div>

      {/* Composite Indices */}
      <div className="bg-mv-bg-tertiary rounded-xl p-4">
        <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
          Composite Indices
        </h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <ParamItem label="STP" value={derived.stp} decimals={1} threshold={1} />
          <ParamItem label="SCP" value={derived.scp} decimals={1} threshold={1} />
          <ParamItem label="SHIP" value={derived.ship} decimals={1} threshold={1} />
          <ParamItem label="EHI 0-1km" value={derived.ehi_0_1km} decimals={1} threshold={1} />
          <ParamItem label="EHI 0-3km" value={derived.ehi_0_3km} decimals={1} threshold={2} />
          <ParamItem label="Crit Angle" value={derived.critical_angle || 0} unit="°" decimals={0} />
        </div>
      </div>

      {/* Classic Indices */}
      <div className="bg-mv-bg-tertiary rounded-xl p-4">
        <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
          Classic Indices
        </h4>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <ParamItem label="K Index" value={derived.k_index} decimals={0} threshold={30} />
          <ParamItem label="Total Totals" value={derived.totals_totals} decimals={0} threshold={50} />
          <ParamItem label="SWEAT" value={derived.sweat_index} decimals={0} threshold={300} />
          {derived.dcape !== undefined && (
            <ParamItem label="DCAPE" value={derived.dcape} unit="J/kg" threshold={800} />
          )}
        </div>
      </div>
    </div>
  );
}

function ParamItem({
  label,
  value,
  unit,
  decimals = 0,
  threshold,
  inverse = false,
}: {
  label: string;
  value: number;
  unit?: string;
  decimals?: number;
  threshold?: number;
  inverse?: boolean;
}) {
  // Determine if value exceeds threshold (for highlighting)
  let isSignificant = false;
  if (threshold !== undefined) {
    isSignificant = inverse ? value < -threshold : value > threshold;
  }

  const displayValue = isNaN(value) ? '--' : value.toFixed(decimals);

  return (
    <div className="bg-mv-bg-secondary rounded-lg p-2">
      <span className="text-mv-text-muted block text-xs">{label}</span>
      <span
        className={`font-medium ${
          isSignificant ? 'text-orange-400' : 'text-mv-text-primary'
        }`}
      >
        {displayValue}
        {unit && <span className="text-xs text-mv-text-muted ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

export default DerivedParamsCard;
