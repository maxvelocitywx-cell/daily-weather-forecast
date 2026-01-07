'use client';

import {
  Sun,
  Cloud,
  CloudSun,
  CloudRain,
  CloudDrizzle,
  CloudSnow,
  Snowflake,
  CloudLightning,
  CloudFog,
  Wind,
  Thermometer,
  ThermometerSun,
  ThermometerSnowflake,
  AlertTriangle,
  Cloudy,
  type LucideProps,
} from 'lucide-react';
import clsx from 'clsx';

// Size mappings for lucide icons
const sizeMap = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};

interface IconProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

// Condition type to match spec requirements
export type ConditionType =
  | 'sunny'
  | 'mostly-sunny'
  | 'partly-cloudy'
  | 'mostly-cloudy'
  | 'cloudy'
  | 'rain'
  | 'heavy-rain'
  | 'snow-showers'
  | 'heavy-snow'
  | 'storms'
  | 'isolated-storms'
  | 'scattered-storms'
  | 'sleet'
  | 'freezing-rain'
  | 'mixed-precip'
  | 'windy'
  | 'fog';

// Get condition icon component based on condition type
export function getConditionIcon(condition: ConditionType, props?: IconProps) {
  const size = sizeMap[props?.size || 'md'];
  const baseProps: LucideProps = { size, className: props?.className };

  switch (condition) {
    case 'sunny':
      return <Sun {...baseProps} className={clsx('text-yellow-400', props?.className)} />;
    case 'mostly-sunny':
      return <CloudSun {...baseProps} className={clsx('text-yellow-300', props?.className)} />;
    case 'partly-cloudy':
      return <CloudSun {...baseProps} className={clsx('text-gray-300', props?.className)} />;
    case 'mostly-cloudy':
      return <Cloud {...baseProps} className={clsx('text-gray-400', props?.className)} />;
    case 'cloudy':
      return <Cloud {...baseProps} className={clsx('text-gray-500', props?.className)} />;
    case 'rain':
      return <CloudDrizzle {...baseProps} className={clsx('text-blue-400', props?.className)} />;
    case 'heavy-rain':
      return <CloudRain {...baseProps} className={clsx('text-blue-500', props?.className)} />;
    case 'snow-showers':
      return <CloudSnow {...baseProps} className={clsx('text-sky-300', props?.className)} />;
    case 'heavy-snow':
      return <Snowflake {...baseProps} className={clsx('text-sky-200', props?.className)} />;
    case 'storms':
      return <CloudLightning {...baseProps} className={clsx('text-yellow-500', props?.className)} />;
    case 'isolated-storms':
      return <CloudLightning {...baseProps} className={clsx('text-yellow-400', props?.className)} />;
    case 'scattered-storms':
      return <CloudLightning {...baseProps} className={clsx('text-orange-400', props?.className)} />;
    case 'sleet':
      return <CloudSnow {...baseProps} className={clsx('text-cyan-400', props?.className)} />;
    case 'freezing-rain':
      return <CloudDrizzle {...baseProps} className={clsx('text-cyan-300', props?.className)} />;
    case 'mixed-precip':
      return <CloudSnow {...baseProps} className={clsx('text-purple-300', props?.className)} />;
    case 'windy':
      return <Wind {...baseProps} className={clsx('text-teal-400', props?.className)} />;
    case 'fog':
      return <CloudFog {...baseProps} className={clsx('text-gray-400', props?.className)} />;
    default:
      return <Cloud {...baseProps} className={clsx('text-gray-400', props?.className)} />;
  }
}

// Condition label with human-readable text
export function getConditionLabel(condition: ConditionType): string {
  switch (condition) {
    case 'sunny': return 'Sunny';
    case 'mostly-sunny': return 'Mostly Sunny';
    case 'partly-cloudy': return 'Partly Cloudy';
    case 'mostly-cloudy': return 'Mostly Cloudy';
    case 'cloudy': return 'Cloudy';
    case 'rain': return 'Rain';
    case 'heavy-rain': return 'Heavy Rain';
    case 'snow-showers': return 'Snow Showers';
    case 'heavy-snow': return 'Heavy Snow';
    case 'storms': return 'Storms';
    case 'isolated-storms': return 'Isolated Storms';
    case 'scattered-storms': return 'Scattered Storms';
    case 'sleet': return 'Sleet';
    case 'freezing-rain': return 'Freezing Rain';
    case 'mixed-precip': return 'Mixed Precip';
    case 'windy': return 'Windy';
    case 'fog': return 'Fog';
    default: return 'Unknown';
  }
}

// Legacy icons (kept for backward compatibility)
export function SnowIcon({ size = 'md', className }: IconProps) {
  return <Snowflake size={sizeMap[size]} className={clsx('text-sky-300', className)} />;
}

export function RainIcon({ size = 'md', className }: IconProps) {
  return <CloudRain size={sizeMap[size]} className={clsx('text-blue-400', className)} />;
}

export function WindIcon({ size = 'md', className }: IconProps) {
  return <Wind size={sizeMap[size]} className={clsx('text-teal-400', className)} />;
}

export function TempIcon({
  size = 'md',
  className,
  variant = 'neutral',
}: IconProps & { variant?: 'hot' | 'cold' | 'neutral' }) {
  const Icon = variant === 'hot' ? ThermometerSun : variant === 'cold' ? ThermometerSnowflake : Thermometer;
  const colorClass = variant === 'hot' ? 'text-red-400' : variant === 'cold' ? 'text-blue-400' : 'text-gray-400';
  return <Icon size={sizeMap[size]} className={clsx(colorClass, className)} />;
}

export function SunIcon({ size = 'md', className }: IconProps) {
  return <Sun size={sizeMap[size]} className={clsx('text-yellow-400', className)} />;
}

export function CloudIcon({ size = 'md', className }: IconProps) {
  return <Cloud size={sizeMap[size]} className={clsx('text-gray-400', className)} />;
}

export function ThunderstormIcon({ size = 'md', className }: IconProps) {
  return <CloudLightning size={sizeMap[size]} className={clsx('text-yellow-500', className)} />;
}

export function FogIcon({ size = 'md', className }: IconProps) {
  return <CloudFog size={sizeMap[size]} className={clsx('text-gray-500', className)} />;
}

export function AlertIcon({ size = 'md', className }: IconProps) {
  return <AlertTriangle size={sizeMap[size]} className={clsx('text-red-500', className)} />;
}

// Condition badge component - shows icon + label together
export function ConditionBadge({
  condition,
  secondary,
  size = 'sm',
  showLabel = true,
  className,
}: {
  condition: ConditionType;
  secondary?: 'windy';
  size?: 'xs' | 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('inline-flex items-center gap-1.5', className)}>
      {getConditionIcon(condition, { size })}
      {showLabel && (
        <span className="text-xs text-mv-text-secondary">
          {getConditionLabel(condition)}
          {secondary === 'windy' && ' & Windy'}
        </span>
      )}
      {secondary === 'windy' && !showLabel && (
        <Wind size={sizeMap[size]} className="text-teal-400" />
      )}
    </div>
  );
}
