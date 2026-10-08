"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { CircleAlert, Clock, Loader2, Lock, MessageCircle, RefreshCw, SendHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCarpoolFormat } from "@/components/carpool/use-carpool-format";
import { dateKey } from "@/lib/datetime";
import { BffError, bffFetch, isOnline, useOnlineStatus } from "@/lib/offline";
import { useRealtimeEvent, useRealtimeRoom, useRealtimeStatus } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { messagesPath } from "@/lib/carpool/paths";
import {
  CHAT_OPEN_AFTER_DEPARTURE_MS,
  isMessagePage,
  isTripMessage,
  MESSAGE_MAX,
  type MessagePage,
  type TripDetail,
  type TripMessage,
} from "@/lib/carpool/types";
import { cleanText, validateChatMessage } from "@/lib/carpool/validation";
import { sendMessageAction } from "@/app/(back)/dashboard/carpool/actions";

/** A message being sent: "sending", "waiting" (offline: sent on reconnection) or "failed" (refused). */
type Pending = { clientRequestId: string; body: string; createdAt: string; state: "sending" | "waiting" | "failed"; error?: string };

type ChatState = { messages: TripMessage[]; hasMore: boolean; pending: Pending[] };

type ChatAction =
  | { type: "page"; items: TripMessage[]; hasMore: boolean; older: boolean }
  | { type: "received"; message: TripMessage }
  | { type: "pending"; pending: Pending }
  | { type: "pendingState"; clientRequestId: string; state: Pending["state"]; error?: string }
  | { type: "remove"; clientRequestId: string };

const byTime = (a: TripMessage, b: TripMessage) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Union by id (a refetch never drops what is shown), oldest first. */
function merge(current: TripMessage[], incoming: TripMessage[]): TripMessage[] {
  if (incoming.length === 0) return current;
  const map = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) map.set(message.id, message);
  return [...map.values()].sort(byTime);
}

function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "page": {
      const messages = merge(state.messages, action.items);
      const sent = new Set(action.items.map((message) => message.clientRequestId).filter(Boolean));
      return {
        messages,
        // An older page tells whether even older ones exist; the latest page only matters when nothing was loaded.
        hasMore: action.older || state.messages.length === 0 ? action.hasMore : state.hasMore,
        pending: state.pending.filter((item) => !sent.has(item.clientRequestId)),
      };
    }
    case "received":
      return {
        ...state,
        messages: merge(state.messages, [action.message]),
        pending: state.pending.filter((item) => item.clientRequestId !== action.message.clientRequestId),
      };
    case "pending":
      return { ...state, pending: [...state.pending.filter((item) => item.clientRequestId !== action.pending.clientRequestId), action.pending] };
    case "pendingState":
      return {
        ...state,
        pending: state.pending.map((item) => (item.clientRequestId === action.clientRequestId ? { ...item, state: action.state, error: action.error } : item)),
      };
    case "remove":
      return { ...state, pending: state.pending.filter((item) => item.clientRequestId !== action.clientRequestId) };
  }
}

/** Random UUID v4 (crypto.randomUUID only exists in secure contexts: plain-http hosts get the fallback). */
function newClientRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const NEAR_BOTTOM_PX = 120;

/** Live indicator: connection + room state, in words (a dot alone would not be accessible). */
function ConnectionIndicator({ roomStatus, roomError }: { roomStatus: "joining" | "joined" | "error"; roomError: string | null }) {
  const t = useTranslations("carpool.chat.status");
  const status = useRealtimeStatus();
  const online = useOnlineStatus();
  const key =
    !online || status === "offline"
      ? "offline"
      : status === "unavailable"
        ? "unavailable"
        : status === "reconnecting"
          ? "reconnecting"
          : status !== "connected"
            ? "connecting"
            : roomStatus === "joined"
              ? "connected"
              : roomStatus === "error" && roomError !== "TIMEOUT"
                ? "error"
                : "connecting";
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="chat-connection" data-state={key}>
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          key === "connected" ? "bg-success" : key === "offline" || key === "error" || key === "unavailable" ? "bg-destructive" : "animate-pulse bg-highlight motion-reduce:animate-none"
        )}
      />
      {t(key)}
    </p>
  );
}

/**
 * Real-time chat of a trip (driver + accepted passengers). Messages are persisted by the API and pushed to the
 * room `trip:<id>` as `chat:message`; sending is optimistic (the message shows at once with "Sending…") and
 * idempotent (clientRequestId: a retry never duplicates). Offline, messages wait and are sent on reconnection;
 * after a reconnection the latest messages are fetched again, so nothing missed while away is lost.
 */
export function TripChat({
  trip,
  viewerId,
  now,
  initial,
}: {
  trip: TripDetail;
  viewerId: string;
  now: number;
  initial: { data: MessagePage; savedAt: number } | null;
}) {
  const t = useTranslations("carpool.chat");
  const format = useCarpoolFormat();
  const online = useOnlineStatus();
  const [state, dispatch] = useReducer(reducer, null, () => ({
    messages: initial ? [...initial.data.items].filter(isTripMessage).sort(byTime) : [],
    hasMore: initial?.data.hasMore ?? false,
    pending: [],
  }));
  const [loading, setLoading] = useState(!initial);
  const [loadError, setLoadError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const loadedAt = useRef(initial?.savedAt ?? 0);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFrom = useRef<number | null>(null);
  const inFlight = useRef(new Set<string>());

  const room = useRealtimeRoom(`trip:${trip.id}`);
  const closedReason =
    trip.status === "CANCELLED" ? "cancelled" : new Date(trip.departureAt).getTime() + CHAT_OPEN_AFTER_DEPARTURE_MS <= now ? "old" : null;

  // ---------- Loading

  // The latest page, or null when the server can't be reached (offline: nothing to report), or "error".
  const fetchLatest = useCallback(async (): Promise<MessagePage | "error" | null> => {
    if (!isOnline()) return null;
    try {
      const page = await bffFetch<MessagePage>(messagesPath(trip.id));
      return isMessagePage(page) ? page : "error";
    } catch (error) {
      return error instanceof BffError && error.isNetworkError ? null : "error";
    }
  }, [trip.id]);

  const applyLatest = useCallback((result: MessagePage | "error" | null) => {
    setLoading(false);
    if (result === "error") {
      setLoadError(true);
      return;
    }
    if (!result) return;
    loadedAt.current = Date.now();
    dispatch({ type: "page", items: result.items.filter(isTripMessage), hasMore: result.hasMore, older: false });
    setLoadError(false);
  }, []);

  const loadLatest = useCallback(() => fetchLatest().then(applyLatest), [fetchLatest, applyLatest]);

  // No server copy (the viewer just became a participant): load now.
  useEffect(() => {
    if (!initial) void fetchLatest().then(applyLatest);
  }, [initial, fetchLatest, applyLatest]);

  // Every successful join (first connection or reconnection): fetch what may have been missed meanwhile.
  const joins = room.joins;
  useEffect(() => {
    if (joins === 0) return;
    if (joins > 1 || Date.now() - loadedAt.current > 2_000) void fetchLatest().then(applyLatest);
  }, [joins, fetchLatest, applyLatest]);

  const oldest = state.messages[0]?.id ?? null;
  const loadOlder = async () => {
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    restoreFrom.current = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop : null;
    try {
      const page = await bffFetch<MessagePage>(messagesPath(trip.id, oldest));
      if (isMessagePage(page)) dispatch({ type: "page", items: page.items.filter(isTripMessage), hasMore: page.hasMore, older: true });
    } catch {
      restoreFrom.current = null;
    } finally {
      setLoadingOlder(false);
    }
  };

  // ---------- Live messages

  useRealtimeEvent<TripMessage>("chat:message", (message) => {
    if (!isTripMessage(message) || message.tripId !== trip.id) return;
    if (scroller.current) {
      const { scrollHeight, scrollTop, clientHeight } = scroller.current;
      stickToBottom.current = scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_PX || message.sender.id === viewerId;
    }
    dispatch({ type: "received", message });
  });

  // ---------- Sending

  const deliver = useCallback(
    async (pending: Pick<Pending, "clientRequestId" | "body">) => {
      if (inFlight.current.has(pending.clientRequestId)) return;
      if (!isOnline()) {
        dispatch({ type: "pendingState", clientRequestId: pending.clientRequestId, state: "waiting" });
        return;
      }
      inFlight.current.add(pending.clientRequestId);
      dispatch({ type: "pendingState", clientRequestId: pending.clientRequestId, state: "sending" });
      try {
        const result = await sendMessageAction(trip.id, { body: pending.body, clientRequestId: pending.clientRequestId });
        if (result.ok && result.data?.message && isTripMessage(result.data.message)) {
          dispatch({ type: "received", message: result.data.message });
        } else {
          dispatch({ type: "pendingState", clientRequestId: pending.clientRequestId, state: "failed", error: result.message });
        }
      } catch {
        // The server could not be reached: keep it for the reconnection.
        dispatch({ type: "pendingState", clientRequestId: pending.clientRequestId, state: "waiting" });
      } finally {
        inFlight.current.delete(pending.clientRequestId);
      }
    },
    [trip.id]
  );

  const send = (event?: React.FormEvent) => {
    event?.preventDefault();
    const problem = validateChatMessage(draft);
    if (problem) {
      setDraftError(problem.key === "messageRequired" ? null : t("tooLong", { max: MESSAGE_MAX }));
      return;
    }
    const pending: Pending = {
      clientRequestId: newClientRequestId(),
      body: cleanText(draft),
      createdAt: new Date().toISOString(),
      state: isOnline() ? "sending" : "waiting",
    };
    stickToBottom.current = true;
    dispatch({ type: "pending", pending });
    setDraft("");
    setDraftError(null);
    void deliver(pending);
  };

  // Back online / reconnected: send what waited, in order (Server Actions run one at a time).
  const waiting = state.pending.filter((item) => item.state === "waiting");
  const waitingKey = waiting.map((item) => item.clientRequestId).join(",");
  const waitingRef = useRef(waiting);
  useLayoutEffect(() => {
    waitingRef.current = waiting;
  });
  useEffect(() => {
    if (!online || !waitingKey) return;
    for (const item of waitingRef.current) void deliver(item);
  }, [online, waitingKey, joins, deliver]);

  // ---------- Scrolling: stay at the bottom when a message arrives (unless reading older ones)

  const lastId = state.messages[state.messages.length - 1]?.id;
  const count = state.messages.length + state.pending.length;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (restoreFrom.current !== null) {
      element.scrollTop = element.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
      return;
    }
    if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [lastId, count]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  // ---------- Rendering

  // A day heading above the first message of each day ("Today", "Tomorrow", "Mon, Oct 5").
  const dayLabels = state.messages.map((message, index) =>
    index === 0 || dateKey(message.createdAt) !== dateKey(state.messages[index - 1].createdAt) ? format.day(message.createdAt, now) : null
  );

  const remaining = MESSAGE_MAX - draft.length;

  return (
    <section aria-labelledby="chat-title" className="flex flex-col rounded-3xl border bg-card text-card-foreground lg:sticky lg:top-20">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b p-4 sm:px-6">
        <div className="min-w-0">
          <h2 id="chat-title" className="flex items-center gap-2 text-lg font-semibold">
            <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" />
            {t("title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <ConnectionIndicator roomStatus={room.status} roomError={room.error} />
      </div>

      <div ref={scroller} onScroll={onScroll} className="max-h-[60vh] min-h-64 overflow-y-auto px-3 py-4 sm:px-5 lg:max-h-[calc(100dvh-20rem)]">
        {state.hasMore && (
          <div className="mb-3 flex justify-center">
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder || !online} aria-busy={loadingOlder || undefined}>
              {loadingOlder && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {t("loadEarlier")}
            </Button>
          </div>
        )}
        {loading && state.messages.length === 0 && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t("loading")}
          </p>
        )}
        {loadError && state.messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
            <p>{t("loadError")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadLatest()} disabled={!online}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("retryLoad")}
            </Button>
          </div>
        )}
        {!loading && !loadError && count === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>}

        {/* The live region wraps the list: role="log" on the <ol> itself would remove its list semantics. */}
        <div role="log" aria-labelledby="chat-title" aria-live="polite" aria-relevant="additions" data-testid="chat-log">
          <ol className="space-y-2">
            {state.messages.map((message, index) => {
              const mine = message.sender.id === viewerId;
              const day = dayLabels[index];
              return (
                <li key={message.id} data-message-id={message.id} data-mine={mine ? "true" : "false"} data-state="sent" className="space-y-2">
                  {day && (
                    <p className="pt-2 text-center text-xs font-medium text-muted-foreground" aria-hidden="true">
                      {day}
                    </p>
                  )}
                  <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                        mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground"
                      )}
                    >
                      <p className={cn("text-xs font-semibold", mine ? "sr-only" : "text-primary")}>{mine ? t("you") : format.name(message.sender)}</p>
                      <p className="whitespace-pre-wrap break-words" data-testid="chat-body">
                        {message.body}
                      </p>
                      <p className={cn("mt-1 text-right text-[0.7rem]", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
                        <time dateTime={message.createdAt}>{format.time(message.createdAt)}</time>
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
            {state.pending.map((item) => (
              <li key={item.clientRequestId} data-client-request-id={item.clientRequestId} data-mine="true" data-state={item.state} className="flex flex-col items-end gap-1">
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm",
                    item.state === "failed" ? "border border-destructive/40 bg-destructive/10 text-foreground" : "bg-primary/70 text-primary-foreground"
                  )}
                >
                  <p className="sr-only">{t("you")}</p>
                  <p className="whitespace-pre-wrap break-words" data-testid="chat-body">
                    {item.body}
                  </p>
                </div>
                <p className={cn("flex flex-wrap items-center justify-end gap-2 text-xs", item.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
                  {item.state === "sending" && (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      {t("sending")}
                    </>
                  )}
                  {item.state === "waiting" && (
                    <>
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {t("waiting")}
                    </>
                  )}
                  {item.state === "failed" && (
                    <>
                      <CircleAlert className="h-3 w-3" aria-hidden="true" />
                      {item.error ?? t("failed")}
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void deliver(item)} disabled={!online}>
                        {t("retry")}
                      </Button>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs text-muted-foreground"
                        onClick={() => dispatch({ type: "remove", clientRequestId: item.clientRequestId })}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        {t("remove")}
                      </Button>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="border-t p-3 sm:px-5">
        {closedReason ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="chat-closed">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {closedReason === "cancelled" ? t("closedCancelled") : t("closedOld")}
          </p>
        ) : (
          <form onSubmit={send} className="space-y-1.5" aria-label={t("composer")}>
            <label htmlFor="chat-message" className="sr-only">
              {t("message")}
            </label>
            <div className="flex items-end gap-2">
              <Textarea
                id="chat-message"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (draftError) setDraftError(null);
                }}
                onKeyDown={onKeyDown}
                maxLength={MESSAGE_MAX}
                rows={2}
                placeholder={t("placeholder")}
                aria-describedby={draftError ? "chat-hint chat-error" : "chat-hint"}
                aria-invalid={draftError ? true : undefined}
                className="min-h-11 resize-none"
              />
              <Button type="submit" className="h-11 shrink-0" disabled={!draft.trim()}>
                <SendHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{t("send")}</span>
              </Button>
            </div>
            <p id="chat-hint" className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span className="hidden sm:inline">{t("hint")}</span>
              <span className={cn("ml-auto", remaining < 50 && "text-destructive")} aria-hidden={remaining >= 50 || undefined}>
                {t("remaining", { count: remaining })}
              </span>
            </p>
            {draftError && (
              <p id="chat-error" className="text-xs text-destructive">
                {draftError}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
