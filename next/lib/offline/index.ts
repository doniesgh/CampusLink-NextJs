// Public API of the offline data layer (Client Components only). See next/README.md.
export { BffError, bffFetch, bffUrl, type BffMethod, type BffRequest } from "@/lib/bff-client";
export {
  invalidateQueries,
  serializeKey,
  useOfflineQuery,
  useQueryClient,
  type OfflineQueryOptions,
  type OfflineQueryResult,
  type QueryKey,
} from "@/lib/offline/query";
export {
  OUTBOX_REPLAYED_EVENT,
  queueMutation,
  refreshPendingCount,
  replayOutbox,
  type MutationRequest,
  type MutationResult,
} from "@/lib/offline/outbox";
export { isOnline, useConnectivity, useOnlineStatus, usePendingCount } from "@/lib/offline/status";
