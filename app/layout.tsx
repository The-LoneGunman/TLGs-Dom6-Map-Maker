import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const PRODUCT_NAME = "Pantokrator Atlas";
const PRODUCT_TITLE = `${PRODUCT_NAME} — Dominions 6 Map Forge`;
const PRODUCT_DESCRIPTION =
  "Create deterministic, multiplayer-friendly Dominions 6 maps with native dynamic terrain, up to eight linked planes, starts, thrones, magic sites, and unique guardians.";
const FALLBACK_HOST = "localhost:3000";

function firstForwardedValue(value: string | null): string | undefined {
  return value?.split(",", 1)[0]?.trim() || undefined;
}

/**
 * Accept only a bare HTTP authority. This keeps malformed or injected proxy
 * headers out of canonical and social URLs while still supporting Sites,
 * localhost ports, and IPv6 development addresses.
 */
export function safeMetadataHost(value: string | null): string | undefined {
  const candidate = firstForwardedValue(value);
  if (!candidate || /[\\/@?#\s]/.test(candidate)) return undefined;

  try {
    const parsed = new URL(`http://${candidate}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return undefined;
    return parsed.host || undefined;
  } catch {
    return undefined;
  }
}

export function metadataBaseForHeaders(requestHeaders: Pick<Headers, "get">): URL {
  const forwardedHost = safeMetadataHost(requestHeaders.get("x-forwarded-host"));
  const requestHost = safeMetadataHost(requestHeaders.get("host"));
  const host = forwardedHost ?? requestHost ?? FALLBACK_HOST;
  const forwardedProtocol = firstForwardedValue(requestHeaders.get("x-forwarded-proto"))?.toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|$)/i.test(host)
      ? "http"
      : "https";

  return new URL(`${protocol}://${host}`);
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const base = metadataBaseForHeaders(requestHeaders);

  return {
    metadataBase: base,
    applicationName: PRODUCT_NAME,
    title: PRODUCT_TITLE,
    description: PRODUCT_DESCRIPTION,
    category: "games",
    keywords: ["Dominions 6", "map generator", "map editor", "multiplayer map", "Dominions map"],
    creator: "The Lone Gunman",
    publisher: "The Lone Gunman",
    referrer: "strict-origin-when-cross-origin",
    alternates: { canonical: "/" },
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/app-icon-192.png", type: "image/png", sizes: "192x192" },
      ],
      shortcut: "/favicon.svg",
      apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
    },
    appleWebApp: {
      capable: true,
      title: PRODUCT_NAME,
      statusBarStyle: "black-translucent",
    },
    formatDetection: { telephone: false },
    robots: { index: true, follow: true },
    openGraph: {
      title: PRODUCT_NAME,
      description: "A native Dominions 6 map forge for varied, balanced, multi-plane worlds.",
      type: "website",
      url: "/",
      siteName: PRODUCT_NAME,
      locale: "en_US",
      images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Pantokrator Atlas map forge" }],
    },
    twitter: {
      card: "summary_large_image",
      title: PRODUCT_NAME,
      description: "Create balanced native Dominions 6 maps across up to eight linked planes.",
      images: ["/og.png"],
    },
  };
}

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0f1516",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
