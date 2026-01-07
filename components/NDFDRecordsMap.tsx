'use client';

import dynamic from 'next/dynamic';

// Dynamically import the map component with SSR disabled
const NDFDRecordsMapClient = dynamic(() => import('./NDFDRecordsMapClient'), {
  ssr: false,
  loading: () => <RecordsMapPlaceholder />,
});

export function NDFDRecordsMap() {
  return <NDFDRecordsMapClient />;
}

function RecordsMapPlaceholder() {
  return (
    <div className="w-full h-full min-h-[600px] rounded-xl bg-mv-bg-secondary border border-white/5 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-4" />
        <div className="text-mv-text-muted mb-2">Loading Temperature Records Map...</div>
        <div className="text-xs text-mv-text-muted/60">
          Fetching NDFD data from WPC
        </div>
      </div>
    </div>
  );
}
