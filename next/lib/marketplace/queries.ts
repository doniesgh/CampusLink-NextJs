"use client";

// Offline-first reads shared by the marketplace pages (Client Components only).
import { useOfflineQuery } from "@/lib/offline";
import { CONFIG_KEY, CONFIG_PATH, SUBJECTS_KEY, SUBJECTS_PATH, walletKey, walletPath } from "@/lib/marketplace/paths";
import { DEFAULT_MAX_UPLOAD_MB, isWallet, MAX_PRICE, type MarketConfig, type Wallet } from "@/lib/marketplace/types";
import type { Subject } from "@/lib/types";

/** Server-rendered data handed to a hook: `{ data, savedAt }` (serverSnapshot), data null on failure. */
export type Snapshot<T> = { data: T | null; savedAt: number } | null;

export const seed = <T>(snapshot: Snapshot<T> | undefined) => ({
  fallbackData: snapshot?.data ?? undefined,
  fallbackSavedAt: snapshot?.savedAt,
  revalidateOnMount: !snapshot?.data,
});

/** Subjects of the filters and of the upload form (GET /api/academic/subjects). */
export function useMarketSubjects(initial?: Snapshot<Subject[]>, enabled = true): Subject[] {
  const { data } = useOfflineQuery<Subject[]>(SUBJECTS_KEY, enabled ? SUBJECTS_PATH : null, { ...seed(initial), reportLastUpdated: false });
  return Array.isArray(data) ? data : [];
}

const DEFAULT_CONFIG: MarketConfig = {
  startingTokens: 100,
  minPrice: 0,
  maxPrice: MAX_PRICE,
  maxUploadMb: DEFAULT_MAX_UPLOAD_MB,
  allowedExtensions: [],
  allowedMimeTypes: [],
  types: [],
  statuses: [],
};

/** Limits of the forms (GET /api/marketplace/config): max upload size, starting tokens. */
export function useMarketConfig(initial?: Snapshot<MarketConfig>, enabled = true): MarketConfig {
  const { data } = useOfflineQuery<MarketConfig>(CONFIG_KEY, enabled ? CONFIG_PATH : null, { ...seed(initial), reportLastUpdated: false });
  return data && typeof data.maxUploadMb === "number" ? data : DEFAULT_CONFIG;
}

/** First page of the wallet: balance (header pill, purchase confirmation) and the latest movements. */
export function useWallet(initial?: Snapshot<Wallet>, page = 1) {
  const query = useOfflineQuery<Wallet>(walletKey(page), walletPath(page), page === 1 ? seed(initial) : {});
  return { ...query, data: isWallet(query.data) ? query.data : undefined };
}
