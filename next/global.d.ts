// Type-safe next-intl: message keys are checked against the English files (the reference locale).
// Every key must exist in messages/en/<namespace>.json AND messages/fr/<namespace>.json.
import type account from "./messages/en/account.json";
import type admin from "./messages/en/admin.json";
import type alumni from "./messages/en/alumni.json";
import type analytics from "./messages/en/analytics.json";
import type announcements from "./messages/en/announcements.json";
import type auth from "./messages/en/auth.json";
import type bookings from "./messages/en/bookings.json";
import type carpool from "./messages/en/carpool.json";
import type common from "./messages/en/common.json";
import type dashboard from "./messages/en/dashboard.json";
import type forum from "./messages/en/forum.json";
import type landing from "./messages/en/landing.json";
import type marketplace from "./messages/en/marketplace.json";
import type notifications from "./messages/en/notifications.json";
import type offline from "./messages/en/offline.json";
import type timetable from "./messages/en/timetable.json";
import type { formats } from "./i18n/config";

type Messages = {
  common: typeof common;
  landing: typeof landing;
  auth: typeof auth;
  dashboard: typeof dashboard;
  account: typeof account;
  admin: typeof admin;
  notifications: typeof notifications;
  offline: typeof offline;
  timetable: typeof timetable;
  announcements: typeof announcements;
  bookings: typeof bookings;
  forum: typeof forum;
  analytics: typeof analytics;
  carpool: typeof carpool;
  marketplace: typeof marketplace;
  alumni: typeof alumni;
};

declare module "next-intl" {
  interface AppConfig {
    Locale: "fr" | "en";
    Messages: Messages;
    Formats: typeof formats;
  }
}
