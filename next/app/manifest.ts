import type { MetadataRoute } from "next";

// Web app manifest (served at /manifest.webmanifest and linked from every page).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CampusLink",
    short_name: "CampusLink",
    description:
      "Your whole campus in one app: timetable, announcements and notifications, even offline.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: "#253C6D",
    background_color: "#FFFFFF",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Timetable", short_name: "Timetable", url: "/dashboard/timetable", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Announcements", short_name: "Announcements", url: "/dashboard/announcements", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
