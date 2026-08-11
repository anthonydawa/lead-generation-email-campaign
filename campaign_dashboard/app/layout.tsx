import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  const metadataBase = host ? new URL(`${protocol}://${host}`) : undefined;
  const description =
    "Find focused professional audiences, save source-attributed prospects, and run thoughtful email campaigns from one private workspace.";

  return {
    metadataBase,
    title: "Relay — Lead Intelligence & Email Campaigns",
    description,
    openGraph: {
      title: "Relay",
      description: "Find the right people. Reach out thoughtfully.",
      images: [{ url: "/og.png", width: 1731, height: 909, alt: "Relay" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Relay",
      description: "Find the right people. Reach out thoughtfully.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
