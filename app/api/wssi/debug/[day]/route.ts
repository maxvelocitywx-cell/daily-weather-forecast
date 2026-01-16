import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Debug endpoint to check WSSI metrics without rendering
 * GET /api/wssi/debug/{day}?res=overview|detail
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ day: string }> }
) {
  const { day: dayStr } = await params;
  const day = parseInt(dayStr, 10);

  if (isNaN(day) || day < 1 || day > 3) {
    return NextResponse.json({ error: 'Invalid day' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const res = searchParams.get('res') as 'overview' | 'detail' | null;
  const resolution = res === 'detail' ? 'detail' : 'overview';

  try {
    // Fetch from our own API to get metrics
    const baseUrl = request.nextUrl.origin;
    const response = await fetch(`${baseUrl}/api/wssi/day/${day}?res=${resolution}`);

    const features = response.headers.get('X-WSSI-Features') || '0';
    const vertices = response.headers.get('X-WSSI-Vertices') || '0';
    const components = response.headers.get('X-WSSI-Components') || '0';
    const bytes = response.headers.get('X-WSSI-Bytes') || '0';
    const cached = response.headers.get('X-WSSI-Cached') || 'false';
    const processingTime = response.headers.get('X-WSSI-Processing-Time') || 'cached';
    const lastModified = response.headers.get('X-WSSI-Last-Modified') || '';

    const bytesNum = parseInt(bytes, 10);

    return NextResponse.json({
      day,
      resolution,
      metrics: {
        featureCount: parseInt(features, 10),
        vertexCount: parseInt(vertices, 10),
        componentCount: parseInt(components, 10),
        bytes: bytesNum,
        bytesKB: (bytesNum / 1024).toFixed(1),
        bytesMB: (bytesNum / 1024 / 1024).toFixed(2),
      },
      status: {
        cached: cached === 'true',
        processingTimeMs: processingTime,
        lastModified,
        httpStatus: response.status,
      },
      targets: {
        maxFeatures: 5,
        maxBytesKB: 500,
        featureOk: parseInt(features, 10) <= 5,
        bytesOk: bytesNum <= 500 * 1024,
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
