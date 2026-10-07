import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import { getLocale, getTranslations } from "next-intl/server";
import { ClientMessages } from "@/components/i18n/client-messages";
import { ConnectivityBanner } from "@/components/pwa/connectivity-banner";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { StyleNonce } from "@/components/security/style-nonce";
import "./globals.css";

// Body text: Inter (variable font, covers the 400/500 weights used for copy).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Headings: Poppins 600/700 (not a variable font, so weights are explicit).
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: {
      template: "%s · CampusLink",
      default: "CampusLink",
    },
    description: t("metadata.description"),
    applicationName: "CampusLink",
    appleWebApp: { capable: true, title: "CampusLink", statusBarStyle: "default" },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#253C6D" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1424" },
  ],
  colorScheme: "light dark",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    // suppressHydrationWarning: browser extensions (e.g. Office/WebDAV integrations) inject
    // attributes on <html> before React hydrates. It only covers this element's own attributes.
    <html
      lang={locale}
      className={`${inter.variable} ${poppins.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        {/* Client Components get the common and offline messages; route groups add their own namespaces. */}
        <ClientMessages>
          <ConnectivityBanner />
          {children}
          <ServiceWorkerRegistrar />
          <StyleNonce />
        </ClientMessages>
      </body>
    </html>
  );
}
