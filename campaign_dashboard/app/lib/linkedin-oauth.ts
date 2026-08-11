import "server-only";

export const LINKEDIN_CONNECTION_COOKIE = "relay_linkedin_connection";
export const LINKEDIN_STATE_COOKIE = "relay_linkedin_oauth_state";

export type LinkedInConnection = {
  access_token: string;
  expires_at: string;
  profile: {
    sub: string;
    name: string;
    given_name: string;
    family_name: string;
    picture: string;
    email: string;
    email_verified: boolean;
  };
};

export function getLinkedInConfig() {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "LinkedIn OAuth is not configured. Add LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, and LINKEDIN_REDIRECT_URI.",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

export async function sealConnection(
  connection: LinkedInConnection,
  secret: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plaintext = new TextEncoder().encode(JSON.stringify(connection));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(encrypted)}`;
}

export async function openConnection(value: string, secret: string) {
  try {
    const [ivValue, encryptedValue] = value.split(".");
    if (!ivValue || !encryptedValue) return null;
    const iv = base64UrlDecode(ivValue);
    const encrypted = base64UrlDecode(encryptedValue);
    const key = await encryptionKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted,
    );
    const connection = JSON.parse(
      new TextDecoder().decode(plaintext),
    ) as LinkedInConnection;
    if (
      !connection.access_token ||
      !connection.profile?.sub ||
      Date.parse(connection.expires_at) <= Date.now()
    ) {
      return null;
    }
    return connection;
  } catch {
    return null;
  }
}

export function secureCookie() {
  return process.env.NODE_ENV === "production";
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`relay-linkedin:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
