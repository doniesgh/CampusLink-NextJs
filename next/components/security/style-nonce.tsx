"use client";

import { setNonce } from "get-nonce";

// Radix dialogs, sheets and menus (react-remove-scroll) add a <style> element while they are open. It must carry
// the page's CSP nonce (style-src-elem, lib/csp.ts): get-nonce hands it over. Browsers hide the `nonce`
// attribute from the DOM but keep it in the `nonce` property of the scripts Next.js rendered with it.
if (typeof document !== "undefined") {
  const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  if (nonce) setNonce(nonce);
}

/** Rendered once in the root layout so the nonce is known before any dialog opens. */
export function StyleNonce() {
  return null;
}
