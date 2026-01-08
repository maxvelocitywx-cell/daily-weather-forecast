import { NextRequest, NextResponse } from 'next/server';

/**
 * Simple password protection middleware.
 * Set SITE_PASSWORD environment variable in Vercel to enable.
 */

export function middleware(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;

  // If no password is set, allow all requests
  if (!password) {
    return NextResponse.next();
  }

  // Skip protection for API routes (they have their own auth)
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip protection for static files
  if (
    request.nextUrl.pathname.startsWith('/_next/') ||
    request.nextUrl.pathname.startsWith('/favicon') ||
    request.nextUrl.pathname.endsWith('.png') ||
    request.nextUrl.pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('site_auth');
  if (authCookie?.value === password) {
    return NextResponse.next();
  }

  // Check if this is a login attempt
  if (request.method === 'POST' && request.nextUrl.pathname === '/login') {
    return NextResponse.next();
  }

  // Redirect to login page
  if (request.nextUrl.pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
