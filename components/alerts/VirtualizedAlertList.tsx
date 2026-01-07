'use client';

import { useRef, useEffect } from 'react';
import AlertListItem, { AlertListItemData } from './AlertListItem';

interface VirtualizedAlertListProps {
  alerts: AlertListItemData[];
  selectedAlertId: string | null;
  hoveredAlertId: string | null;
  onAlertSelect: (alertId: string) => void;
  onAlertHover: (alertId: string | null) => void;
  height: number;
}

export default function VirtualizedAlertList({
  alerts,
  selectedAlertId,
  hoveredAlertId,
  onAlertSelect,
  onAlertHover,
  height
}: VirtualizedAlertListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Scroll to selected item when selection changes externally
  useEffect(() => {
    if (selectedAlertId) {
      const itemRef = itemRefs.current.get(selectedAlertId);
      if (itemRef) {
        itemRef.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [selectedAlertId]);

  if (alerts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No other alerts
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto custom-scrollbar"
      style={{ height }}
    >
      {alerts.map(alert => (
        <div
          key={alert.id}
          ref={(el) => {
            if (el) itemRefs.current.set(alert.id, el);
          }}
        >
          <AlertListItem
            alert={alert}
            isSelected={selectedAlertId === alert.id}
            isHovered={hoveredAlertId === alert.id}
            onSelect={() => onAlertSelect(alert.id)}
            onHover={(hovering) => onAlertHover(hovering ? alert.id : null)}
          />
        </div>
      ))}
    </div>
  );
}
