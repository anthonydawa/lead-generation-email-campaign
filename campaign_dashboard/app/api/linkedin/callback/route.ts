import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  getLinkedInConfig,
  LINKEDIN_CONNECTION_COOKIE,
  LINKEDIN_STATE_COOKIE,
  sealConnection,
  secureCookie,
} from "../../../lib/linkedin-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { clientId, clientSecret, redirectUri } = getLinkedInConfig();
  const origin = new URL(redirectUri).origin;
  const cookieStore = await cookies();
  const returnedState = request.nextUrl.searchParams.get("state") || "";
  const expectedState = cookieStore.get(LINKEDIN_STATE_COOKIE)?.value || "";
  const providerError = request.nextUrl.searchParams.get("error");

  if (providerError) {
    return redirectWithError(
      origin,
      request.nextUrl.searchParams.get("error_description") ||
        "LinkedIn authorization was cancelled.",
    );
  }

  if (!expectedState || !safeEqual(returnedState, expectedState)) {
    return redirectWithError(
      origin,
      "The LinkedIn sign-in session expired. Please try connecting again.",
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectWithError(origin, "LinkedIn did not return an authorization code.");
  }

  try {
    const tokenResponse = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
        cache: "no-store",
      },
    );
    const tokenPayload = (await tokenResponse.json()) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error(
        tokenPayload.error_description ||
          "LinkedIn could not exchange the authorization code.",
      );
    }

    const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      cache: "no-store",
    });
    const profile = (await profileResponse.json()) as LinkedInUserInfo;
    if (!profileResponse.ok || !profile.sub) {
      throw new Error("LinkedIn connected, but the member profile was unavailable.");
    }

    const expiresIn = Math.max(60, Number(tokenPayload.expires_in || 5184000));
    const sealed = await sealConnection(
      {
        access_token: tokenPayload.access_token,
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        profile: {
          sub: profile.sub,
          name: profile.name || "",
          given_name: profile.given_name || "",
          family_name: profile.family_name || "",
          picture: profile.picture || "",
          email: profile.email || "",
          email_verified: Boolean(profile.email_verified),
        },
      },
      clientSecret,
    );

    const response = NextResponse.redirect(`${origin}/?linkedin=connected`);
    response.cookies.set(LINKEDIN_CONNECTION_COOKIE, sealed, {
      httpOnly: true,
      secure: secureCookie(),
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn,
    });
    response.cookies.delete(LINKEDIN_STATE_COOKIE);
    return response;
  } catch (error) {
    return redirectWithError(
      origin,
      error instanceof Error ? error.message : "LinkedIn connection failed.",
    );
  }
}

function redirectWithError(origin: string, message: string) {
  const response = NextResponse.redirect(
    `${origin}/?linkedin_error=${encodeURIComponent(message)}`,
  );
  response.cookies.delete(LINKEDIN_STATE_COOKIE);
  return response;
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

type LinkedInUserInfo = {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
};
