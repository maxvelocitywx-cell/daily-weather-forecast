import { format, parseISO, isToday, isTomorrow, differenceInDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { RegionId } from './types';

export const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Get the appropriate timezone for a region
 */
export function getRegionTimezone(regionId: RegionId): string {
  switch (regionId) {
    case 'northwest':
    case 'southwest':
      return 'America/Los_Angeles';
    case 'northern_plains':
      return 'America/Denver';
    case 'southern_plains':
      return 'America/Chicago';
    case 'midwest':
      return 'America/Chicago';
    case 'southeast':
    case 'northeast':
    default:
      return 'America/New_York';
  }
}

/**
 * Get the current time in a specific timezone
 */
export function getNowInTimezone(timezone: string): Date {
  return toZonedTime(new Date(), timezone);
}

export interface DayLabelResult {
  dayName: string;
  dayNameShort: string;
  dateLabel: string;
  isToday: boolean;
  isTomorrow: boolean;
}

export interface DayLabelWithDate {
  label: string;      // "Today", "Tom", "Mon", "Tue", etc. (short)
  date: string;       // "Jan 2", "Jan 3", etc.
  fullLabel: string;  // "Today", "Tomorrow", "Monday", etc. (full)
}

/**
 * Get day label with date from index (1 = Today, 2 = Tomorrow, etc.)
 * Returns object with label, date, and fullLabel for flexible display
 */
export function formatDayLabelWithDate(dayIndex: number, timezone: string = DEFAULT_TIMEZONE): DayLabelWithDate {
  const now = getNowInTimezone(timezone);
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + (dayIndex - 1));

  const dateStr = format(targetDate, 'MMM d');

  if (dayIndex === 1) {
    return { label: 'Today', date: dateStr, fullLabel: 'Today' };
  }
  if (dayIndex === 2) {
    return { label: 'Tom', date: dateStr, fullLabel: 'Tomorrow' };
  }

  const dayNameShort = format(targetDate, 'EEE'); // "Mon", "Tue", etc.
  const dayNameFull = format(targetDate, 'EEEE'); // "Monday", "Tuesday", etc.
  return { label: dayNameShort, date: dateStr, fullLabel: dayNameFull };
}

/**
 * Simple day label from index (1 = Today, 2 = Tomorrow, 3+ = day name)
 */
export function formatDayLabel(dayIndex: number): string;
export function formatDayLabel(dateStr: string, now: Date, timezone: string): DayLabelResult;
export function formatDayLabel(
  dayIndexOrDateStr: number | string,
  now?: Date,
  timezone?: string
): string | DayLabelResult {
  // Simple number version - returns day name
  if (typeof dayIndexOrDateStr === 'number') {
    const result = formatDayLabelWithDate(dayIndexOrDateStr);
    return result.fullLabel;
  }

  // Full version with date parsing
  const dateStr = dayIndexOrDateStr;
  const date = parseISO(dateStr);
  const zonedDate = toZonedTime(date, timezone!);
  const zonedNow = toZonedTime(now!, timezone!);

  const dayDiff = differenceInDays(zonedDate, zonedNow);

  let dayName: string;
  let dayNameShort: string;

  if (dayDiff === 0) {
    dayName = 'Today';
    dayNameShort = 'Today';
  } else if (dayDiff === 1) {
    dayName = 'Tomorrow';
    dayNameShort = 'Tom';
  } else {
    dayName = format(zonedDate, 'EEEE');
    dayNameShort = format(zonedDate, 'EEE');
  }

  return {
    dayName,
    dayNameShort,
    dateLabel: format(zonedDate, 'MMM d'),
    isToday: dayDiff === 0,
    isTomorrow: dayDiff === 1,
  };
}

/**
 * Get an array of day labels for the next N days
 */
export function getDayLabels(
  startDate: Date,
  numDays: number,
  timezone: string
): DayLabelResult[] {
  const labels: DayLabelResult[] = [];
  const now = getNowInTimezone(timezone);

  for (let i = 0; i < numDays; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    labels.push(formatDayLabel(date.toISOString(), now, timezone));
  }

  return labels;
}
