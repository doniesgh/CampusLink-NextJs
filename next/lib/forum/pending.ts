// Answers written offline (Client Components only).
//
// An answer is sent with queueMutation(): when the server can't be reached it waits in the IndexedDB outbox
// (lib/offline/outbox.ts) and is replayed on reconnection / by Background Sync. The outbox keeps ONE entry per
// method + path ("last write wins"), so each answer gets its own path: the API path plus "#<clientRequestId>".
// Browsers never send the fragment, so the request is still POST /api/forum/questions/:id/answers, and the
// API answers a replay of the same clientRequestId with the first answer (200) instead of a duplicate.
// The answers waiting to be sent are read back from the outbox itself ("Waiting to sync").
import { useCallback, useEffect, useState } from "react";
import { OUTBOX_REPLAYED_EVENT, usePendingCount } from "@/lib/offline";
import { getDb } from "@/lib/offline/db";
import { getCurrentOwner } from "@/lib/offline/owner";
import { answersPath } from "@/lib/forum/paths";

export type PendingAnswer = { clientRequestId: string; questionId: string; body: string; createdAt: number };

/** Outbox path of one answer: unique per answer, the fragment never reaches the server. */
export const answerOutboxPath = (questionId: string, clientRequestId: string) => `${answersPath(questionId)}#${clientRequestId}`;

/** Random UUID v4 (crypto.randomUUID only exists in secure contexts: plain-http hosts get the fallback). */
export function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The current user's answers to this question still waiting in the outbox, oldest first. */
export async function readPendingAnswers(questionId: string): Promise<PendingAnswer[]> {
  const owner = getCurrentOwner();
  if (!owner) return [];
  try {
    const db = await getDb();
    if (!db) return [];
    const prefix = `${answersPath(questionId)}#`;
    const records = await db.getAll("outbox");
    return records
      .filter((record) => record.owner === owner && record.method === "POST" && record.path.startsWith(prefix))
      .map((record) => {
        const body = (record.body ?? {}) as { body?: unknown; clientRequestId?: unknown };
        return {
          clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : record.path.slice(prefix.length),
          questionId,
          body: typeof body.body === "string" ? body.body : "",
          createdAt: record.createdAt,
        };
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/**
 * Answers to this question waiting to sync. Read again whenever the outbox changes (pending count, replay
 * by the page or by the service worker) and after `reload()`.
 */
export function usePendingAnswers(questionId: string): { items: PendingAnswer[]; reload: () => Promise<void> } {
  const [items, setItems] = useState<PendingAnswer[]>([]);
  const pending = usePendingCount();

  const reload = useCallback(async () => {
    const next = await readPendingAnswers(questionId);
    setItems(next);
  }, [questionId]);

  useEffect(() => {
    let cancelled = false;
    void readPendingAnswers(questionId).then((next) => {
      if (!cancelled) setItems(next);
    });
    return () => {
      cancelled = true;
    };
  }, [questionId, pending]);

  useEffect(() => {
    const onReplayed = () => void reload();
    window.addEventListener(OUTBOX_REPLAYED_EVENT, onReplayed);
    return () => window.removeEventListener(OUTBOX_REPLAYED_EVENT, onReplayed);
  }, [reload]);

  return { items, reload };
}
