"use client";

import { useState } from "react";
import { CheckCircle2, Coins, Download, FileImage, FileText, Loader2, Presentation, ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";
import { extensionLabel, useFileSize } from "@/components/marketplace/use-market-format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import { useErrorFormatter } from "@/lib/i18n/client";
import { useOnlineStatus } from "@/lib/offline";
import { fileHref } from "@/lib/marketplace/paths";
import type { MarketDocument, PurchaseResult } from "@/lib/marketplace/types";
import { purchaseDocumentAction } from "@/app/(back)/dashboard/marketplace/actions";

/** Icon of the file type (image, slides, other documents). */
function FileIcon({ mimeType }: { mimeType: string | undefined }) {
  if (mimeType?.startsWith("image/")) return <FileImage className="h-5 w-5" aria-hidden="true" />;
  if (mimeType?.includes("presentation")) return <Presentation className="h-5 w-5" aria-hidden="true" />;
  return <FileText className="h-5 w-5" aria-hidden="true" />;
}

type PurchaseOutcome = { ok?: boolean; message?: string; code?: string; data?: PurchaseResult };

/**
 * "Buy for 12 tokens" and its confirmation: the price, the balance before and after, and "Purchases are final".
 * The price shown is sent as `expectedPrice`, so the buyer is never charged more than what they confirmed.
 */
function BuyButton({
  document,
  balance,
  onPurchased,
  onStale,
}: {
  document: MarketDocument;
  balance: number | undefined;
  onPurchased: (result: PurchaseResult, message: string | undefined) => void;
  /** The document changed meanwhile (price, already bought, unpublished): reload it. */
  onStale: (message: string) => void;
}) {
  const t = useTranslations("marketplace.buy");
  const tMarket = useTranslations("marketplace");
  const errors = useErrorFormatter();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const price = document.price;
  const missing = balance !== undefined && balance < price ? price - balance : 0;

  const confirm = async () => {
    setPending(true);
    setFeedback(null);
    let result: PurchaseOutcome;
    try {
      result = await purchaseDocumentAction(document.id, price);
    } catch {
      result = { ok: false, message: errors.forCode("NETWORK_ERROR") };
    }
    setPending(false);
    if (result.ok && result.data) {
      setOpen(false);
      onPurchased(result.data, result.message);
      return;
    }
    const message = result.message ?? errors.forCode("GENERIC");
    if (result.code === "ALREADY_PURCHASED" || result.code === "RESOURCE_NOT_FOUND" || result.code === "INVALID_STATE") {
      setOpen(false);
      onStale(message);
      return;
    }
    if (result.code === "PRICE_CHANGED") onStale(message);
    setFeedback({ type: "error", message, at: Date.now() });
  };

  return (
    <div className="space-y-2">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (!next) setFeedback(null);
        }}
      >
        <DialogTrigger asChild>
          <Button
            type="button"
            size="lg"
            className="w-full rounded-full px-4"
            disabled={!online || missing > 0}
            aria-describedby={missing > 0 ? "buy-missing" : undefined}
          >
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            {t("button", { count: price })}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription className="break-words">{t("confirmText", { title: document.title, count: price })}</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 rounded-2xl border bg-muted/40 p-4 text-sm" data-testid="purchase-summary">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t("price")}</dt>
              <dd className="font-semibold tabular-nums">{tMarket("tokens", { count: price })}</dd>
            </div>
            {balance !== undefined && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t("balanceNow")}</dt>
                  <dd className="font-semibold tabular-nums">{tMarket("tokens", { count: balance })}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t pt-2">
                  <dt className="text-muted-foreground">{t("balanceAfter")}</dt>
                  <dd className="font-bold tabular-nums" data-testid="balance-after">
                    {tMarket("tokens", { count: Math.max(0, balance - price) })}
                  </dd>
                </div>
              </>
            )}
          </dl>
          <p className="text-sm text-muted-foreground">{t("final")}</p>
          <InlineFeedback feedback={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={pending || !online} aria-busy={pending || undefined} onClick={() => void confirm()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Coins className="h-4 w-4" aria-hidden="true" />}
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {missing > 0 ? (
        <p id="buy-missing" className="text-sm text-destructive">
          {t("notEnough", { balance: balance ?? 0, missing })}
        </p>
      ) : (
        balance !== undefined && <p className="text-sm text-muted-foreground">{t("yourBalance", { count: balance })}</p>
      )}
      {!online && <p className="text-sm text-muted-foreground">{t("offline")}</p>}
    </div>
  );
}

/**
 * "Get this document" card of the document page: the price, the file, then "Download" (free, bought, mine, ADMIN)
 * or "Buy for <n> tokens" with its confirmation.
 */
export function PurchasePanel({
  document,
  balance,
  onPurchased,
  onStale,
  onDownload,
}: {
  document: MarketDocument;
  balance: number | undefined;
  onPurchased: (result: PurchaseResult, message: string | undefined) => void;
  onStale: (message: string) => void;
  /** A download started (a first download of a free document adds it to the library and allows a review). */
  onDownload: () => void;
}) {
  const t = useTranslations("marketplace.detail");
  const tMarket = useTranslations("marketplace");
  const fileSize = useFileSize();
  const online = useOnlineStatus();
  const premium = document.price > 0;
  const canBuy = premium && !document.mine && !document.canDownload && document.status === "PUBLISHED";

  let ownership: string | null = null;
  if (document.mine) ownership = t("ownDocument");
  else if (premium && document.purchased) ownership = t("bought");
  else if (!premium && document.purchased) ownership = t("downloadedBefore");
  else if (premium && document.canDownload) ownership = t("adminAccess");

  return (
    <section aria-labelledby="get-document-title" className="space-y-4 rounded-3xl border bg-card p-5 text-card-foreground sm:p-6">
      <h2 id="get-document-title" className="sr-only">
        {t("getTitle")}
      </h2>
      <p className="flex items-center gap-2 text-2xl font-bold" data-testid="document-price">
        {premium ? (
          <>
            <Coins className="h-6 w-6 text-highlight" aria-hidden="true" />
            {tMarket("tokens", { count: document.price })}
          </>
        ) : (
          <span className="text-success">{tMarket("free")}</span>
        )}
      </p>

      {document.file && (
        <div className="flex items-center gap-3 rounded-2xl border bg-background p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
            <FileIcon mimeType={document.file.mimeType} />
          </span>
          <span className="min-w-0">
            <span className="block break-all text-sm font-semibold">{document.file.filename}</span>
            <span className="block text-xs text-muted-foreground">
              {[extensionLabel(document.file.filename), fileSize(document.file.size)].filter(Boolean).join(" · ")}
            </span>
          </span>
        </div>
      )}

      {document.canDownload ? (
        <div className="space-y-2">
          <Button asChild size="lg" className="w-full rounded-full px-4">
            <a href={fileHref(document.id)} download onClick={onDownload}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("download")}
            </a>
          </Button>
          {ownership && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="ownership">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              {ownership}
            </p>
          )}
          {!premium && !document.purchased && !document.mine && <p className="text-sm text-muted-foreground">{t("freeHint")}</p>}
          {!online && <p className="text-sm text-muted-foreground">{t("downloadOffline")}</p>}
        </div>
      ) : canBuy ? (
        <BuyButton document={document} balance={balance} onPurchased={onPurchased} onStale={onStale} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </section>
  );
}
