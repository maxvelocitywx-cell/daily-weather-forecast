import WSSIImpactsClient from '@/components/wssi/WSSIImpactsClient';

export const metadata = {
  title: 'WSSI Impacts Slider | Max Velocity Weather',
  description: 'Winter Storm Severity Index Probability Maps - Interactive slider for snow, ice, and blowing snow impacts',
};

export default function WSSIImpactsPage() {
  return <WSSIImpactsClient />;
}
