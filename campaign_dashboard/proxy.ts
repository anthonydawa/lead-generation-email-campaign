import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  const expectedUsername = process.env.DASHBOARD_USERNAME || "admin";

  if (!expectedPassword) {
    return new NextResponse("Dashboard access has not been configured.", {
      status: 503,
    });
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (
        separator >= 0 &&
        safeEqual(username, expectedUsername) &&
        safeEqual(password, expectedPassword)
      ) {
        return NextResponse.next();
      }
    } catch {
      // Fall through to the authentication challenge.
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Relay Campaign Workspace"',
      "Cache-Control": "no-store",
    },
  });
}

function safeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|og.png).*)"],
};
