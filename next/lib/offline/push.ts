// Web push subscription of this device (account page toggle, logout cleanup). Browser only.
import { bffFetch } from "@/lib/bff-client";

export type PushState = "unsupported" | "no-service-worker" | "denied" | "subscribed" | "unsubscribed";

export class PushSetupError extends Error {
  constructor(readonly reason: "unsupported" | "no-service-worker" | "denied" | "failed") {
    super(reason);
    this.name = "PushSetupError";
  }
}

function isSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  try {
    return await navigator.serviceWorker.getRegistration("/");
  } catch {
    return undefined;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function getPushState(): Promise<PushState> {
  if (!isSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  if (!reg) return "no-service-worker";
  const subscription = await reg.pushManager.getSubscription().catch(() => null);
  return subscription ? "subscribed" : "unsubscribed";
}

/** Asks for permission, subscribes with the backend's VAPID key and registers the subscription. */
export async function enablePush(vapidPublicKey: string): Promise<void> {
  if (!isSupported()) throw new PushSetupError("unsupported");
  const reg = await registration();
  if (!reg) throw new PushSetupError("no-service-worker");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushSetupError("denied");

  let subscription: PushSubscription;
  try {
    subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  } catch {
    throw new PushSetupError("failed");
  }

  await bffFetch("/push/subscriptions", { method: "POST", body: subscriptionBody(subscription) });
}

/** Body of POST /push/subscriptions for a browser subscription. */
function subscriptionBody(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return { type: "web", endpoint: subscription.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } };
}

/**
 * Registers this browser's existing push subscription again for the current session (backend upsert by
 * endpoint, idempotent). The backend drops every subscription of the user when all sessions are revoked
 * (change password) and ties each one to the login session that registered it: without this, the toggle
 * would keep showing "subscribed" while nothing reaches this browser anymore.
 * Never asks for permission, never subscribes a browser that is not subscribed, never throws.
 */
export async function resyncPushSubscription(): Promise<void> {
  try {
    if (!isSupported() || Notification.permission !== "granted") return;
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    // A 401 here is not this call's business: the page's own requests handle an ended session.
    await bffFetch("/push/subscriptions", {
      method: "POST",
      body: subscriptionBody(subscription),
      redirectOnUnauthorized: false,
    });
  } catch {
    // Best effort: the next tab session (or the account page toggle) tries again.
  }
}

/** Unregisters this device on the backend, then unsubscribes the browser. */
export async function disablePush(): Promise<void> {
  const reg = isSupported() ? await registration() : undefined;
  const subscription = await reg?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return;
  await bffFetch("/push/subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe().catch(() => false);
}
