import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const WSSI_BASE_URL = 'https://www.wpc.ncep.noaa.gov/wwd/wssi/images/pwssi';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || 'Overall';
  const severity = searchParams.get('severity') || 'moderate';
  const hour = searchParams.get('hour') || '24';

  const imageUrl = `${WSSI_BASE_URL}/web_wssi_p_${category}_${severity}_fhr${hour}.png`;

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'MaxVelocityWeather/1.0',
      },
    });

    if (!response.ok) {
      return new NextResponse(`Image not found: ${response.status}`, {
        status: response.status
      });
    }

    const imageBuffer = await response.arrayBuffer();

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('WSSI image fetch error:', error);
    return new NextResponse('Failed to fetch image', { status: 500 });
  }
}
