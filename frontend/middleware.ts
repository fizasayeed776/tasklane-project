import { NextRequest, NextResponse } from "next/server";

// Cheap gate: real authorization always happens in the API. This only avoids rendering protected shells.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("session"))
    return NextResponse.redirect(new URL("/login", req.url));
}
export const config = {
  matcher: ["/dashboard/:path*", "/projects/:path*", "/tasks/:path*"],
};
