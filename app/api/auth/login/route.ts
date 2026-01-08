import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;

  if (!sitePassword) {
    // No password set, allow access
    return NextResponse.json({ success: true });
  }

  try {
    const { password } = await request.json();

    if (password === sitePassword) {
      const response = NextResponse.json({ success: true });

      // Set auth cookie (httpOnly, secure in production)
      response.cookies.set('site_auth', sitePassword, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      });

      return response;
    }

    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
