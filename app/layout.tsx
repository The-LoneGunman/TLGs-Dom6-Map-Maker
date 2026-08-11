import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", base).toString();
  return {
    metadataBase: base,
    title: "Pantokrator Atlas — Dominions 6 Map Forge",
    description: "Create deterministic, multiplayer-friendly Dominions 6 maps with native dynamic terrain, up to eight linked planes, starts, thrones, magic sites, and unique guardians.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Pantokrator Atlas",
      description: "A native Dominions 6 map forge for varied, balanced, multi-plane worlds.",
      type: "website",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "Pantokrator Atlas map forge" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Pantokrator Atlas",
      description: "Create balanced native Dominions 6 maps across up to eight linked planes.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
