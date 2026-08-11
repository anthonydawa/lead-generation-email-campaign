import { NextResponse } from "next/server";
import {
  getLinkedInConfig,
  LINKEDIN_STATE_COOKIE,
  secureCookie,
} from "../../../lib/linkedin-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { clientId, redirectUri } = getLinkedInConfig();
    const state = crypto.randomUUID().replace(/-/g, "");
    const authorizationUrl = new URL(
      "https://www.linkedin.com/oauth/v2/authorization",
    );
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("scope", "openid profile email");

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(LINKEDIN_STATE_COOKIE, state, {
      httpOnly: true,
      secure: secureCookie(),
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LinkedIn connection failed.";
    return NextResponse.redirect(
      new URL(`/?linkedin_error=${encodeURIComponent(message)}`, appOrigin()),
    );
  }
}

function appOrigin() {
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI;
  if (redirectUri) return new URL(redirectUri).origin;
  return "http://localhost:3000";
}
