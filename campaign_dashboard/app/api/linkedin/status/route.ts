import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getLinkedInConfig,
  LINKEDIN_CONNECTION_COOKIE,
  openConnection,
} from "../../../lib/linkedin-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { clientSecret } = getLinkedInConfig();
    const cookieStore = await cookies();
    const sealed = cookieStore.get(LINKEDIN_CONNECTION_COOKIE)?.value;
    if (!sealed) return NextResponse.json({ connected: false });

    const connection = await openConnection(sealed, clientSecret);
    if (!connection) {
      const response = NextResponse.json({ connected: false });
      response.cookies.delete(LINKEDIN_CONNECTION_COOKIE);
      return response;
    }

    return NextResponse.json({
      connected: true,
      profile: connection.profile,
      expires_at: connection.expires_at,
    });
  } catch {
    return NextResponse.json({ connected: false });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ connected: false });
  response.cookies.delete(LINKEDIN_CONNECTION_COOKIE);
  return response;
}
