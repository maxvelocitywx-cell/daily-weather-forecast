import { Metadata } from 'next';
import WSSIClient from '@/components/wssi/WSSIClient';

export const metadata: Metadata = {
  title: 'Winter Storm Severity Index (WSSI) | MaxVelocity Weather',
  description: 'View WPC Winter Storm Severity Index outlooks showing potential winter weather impacts from snow, ice, wind, and ground conditions.',
};

export default function WSSIPage() {
  return <WSSIClient />;
}
