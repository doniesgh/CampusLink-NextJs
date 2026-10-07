import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
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

export const metadata: Metadata = {
  title: {
    template: "%s · CampusLink",
    default: "CampusLink",
  },
  description:
    "CampusLink is an offline-first student-life platform: timetable, carpooling, course notes, room bookings, help forum, alumni network and announcements in one installable app.",
  applicationName: "CampusLink",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
