import { Metadata } from 'next';
import ModelsClient from '@/components/models/ModelsClient';

export const metadata: Metadata = {
  title: 'Computer Models — Weather Forecast Models | Max Velocity Weather',
  description:
    'Interactive weather model viewer featuring GFS, ECMWF, HRRR, NAM, ICON, and more. View temperature, precipitation, wind, and severe weather parameters.',
  openGraph: {
    title: 'Computer Models — Weather Forecast Models',
    description: 'Interactive weather model viewer with GFS, ECMWF, HRRR, and more',
  },
};

export default function ModelsPage() {
  return <ModelsClient />;
}
