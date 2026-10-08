"use client";

import { useState } from "react";
import { CloudOff, Coins, Gift, HandCoins, RotateCw, ShoppingCart, type LucideIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useDateTimeLabel } from "@/components/marketplace/use-market-format";
import Link from "@/components/ui/app-link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback } from "@/components/ui/feedback";
import { SkeletonList } from "@/components/ui/skeleton";
import { useOnlineStatus } from "@/lib/offline";
import { documentHref, WALLET_PAGE_SIZE } from "@/lib/marketplace/paths";
import { useWallet, type Snapshot } from "@/lib/marketplace/queries";
import type { TransactionType, Wallet, WalletTransaction } from "@/lib/marketplace/types";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<TransactionType, LucideIcon> = {
  STARTING_BONUS: Gift,
  PURCHASE: ShoppingCart,
  SALE: HandCoins,
};

/** One ledger line: what happened, the document, the date, the signed amount and the balance after it. */
function TransactionItem({ transaction }: { transaction: WalletTransaction }) {
  const t = useTranslations("marketplace.wallet");
  const format = useFormatter();
  const dateLabel = useDateTimeLabel();
  const Icon = TYPE_ICONS[transaction.type] ?? Coins;
  const positive = transaction.amount > 0;
  const amount = format.number(transaction.amount, { signDisplay: "exceptZero" });
  return (
    <li
      className="flex items-start gap-3 rounded-2xl border bg-card p-3 text-card-foreground sm:items-center sm:p-4"
      data-transaction-id={transaction.id}
      data-type={transaction.type}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t(`types.${transaction.type}`)}</p>
        {transaction.document && (
          <p className="break-words text-sm">
            <Link href={documentHref(transaction.document.id)} className="text-primary underline-offset-4 hover:underline">
              {transaction.document.title}
            </Link>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          <time dateTime={transaction.createdAt}>{dateLabel(transaction.createdAt)}</time>
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn("text-base font-bold tabular-nums", positive ? "text-success" : "text-destructive")} data-amount={transaction.amount}>
          <span className="sr-only">{t(positive ? "credit" : "debit")} </span>
          {t("amount", { amount })}
        </p>
        <p className="text-xs text-muted-foreground">{t("balanceAfter", { count: transaction.balanceAfter })}</p>
      </div>
    </li>
  );
}

/** Pages 2..n of the history ("Load more"). */
function NextHistoryPage({ page }: { page: number }) {
  const t = useTranslations("marketplace.wallet");
  const tStates = useTranslations("common.states");
  const { data, isLoading } = useWallet(undefined, page);
  if (isLoading) {
    return (
      <li>
        <SkeletonList rows={2} label={tStates("loading")} />
      </li>
    );
  }
  if (!data) return <li className="px-1 text-sm text-muted-foreground">{t("pageError")}</li>;
  return (
    <>
      {data.transactions.map((transaction) => (
        <TransactionItem key={transaction.id} transaction={transaction} />
      ))}
    </>
  );
}

/** "Wallet" tab: the balance, how tokens work, and the history of movements (newest first). */
export function WalletPanel({ initial, startingTokens }: { initial?: Snapshot<Wallet>; startingTokens: number }) {
  const t = useTranslations("marketplace.wallet");
  const tMarket = useTranslations("marketplace");
  const tStates = useTranslations("common.states");
  const tActions = useTranslations("common.actions");
  const online = useOnlineStatus();
  const [pages, setPages] = useState(1);
  const wallet = useWallet(initial);

  if (wallet.isLoading) return <SkeletonList rows={4} label={tStates("loading")} />;
  if (!wallet.data) {
    const offline = !online || !!wallet.error?.isNetworkError || wallet.error?.code === "OFFLINE";
    if (offline) return <EmptyState icon={CloudOff} title={t("notSavedTitle")} description={t("notSavedText")} />;
    return (
      <InlineFeedback feedback={{ type: "error", message: t("loadError") }}>
        <Button variant="outline" size="sm" className="mt-2 rounded-full" onClick={() => void wallet.refresh()}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {tActions("tryAgain")}
        </Button>
      </InlineFeedback>
    );
  }

  const data = wallet.data;
  const total = data.total ?? data.transactions.length;
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <section aria-labelledby="wallet-balance-title" className="rounded-3xl border bg-brand p-5 text-brand-foreground sm:p-6">
        <h2 id="wallet-balance-title" className="text-sm font-medium text-brand-muted-foreground">
          {t("balanceTitle")}
        </h2>
        <p className="mt-2 flex items-baseline gap-2" data-testid="wallet-balance" data-balance={data.balance}>
          <Coins className="h-6 w-6 self-center text-highlight" aria-hidden="true" />
          <span className="text-4xl font-bold tabular-nums">{data.balance}</span>
          <span className="text-base">{tMarket("tokensUnit", { count: data.balance })}</span>
        </p>
        <p className="mt-4 text-sm text-brand-muted-foreground">{t("explain", { count: startingTokens })}</p>
      </section>

      <section aria-labelledby="wallet-history-title" className="min-w-0 space-y-3">
        <h2 id="wallet-history-title" className="text-lg font-semibold">
          {t("historyTitle")}
        </h2>
        {data.transactions.length === 0 ? (
          <EmptyState icon={Coins} title={t("empty")} headingLevel="p" />
        ) : (
          <>
            <ul className="space-y-2" aria-label={t("historyTitle")}>
              {data.transactions.map((transaction) => (
                <TransactionItem key={transaction.id} transaction={transaction} />
              ))}
              {Array.from({ length: pages - 1 }, (_, index) => (
                <NextHistoryPage key={index + 2} page={index + 2} />
              ))}
            </ul>
            {total > pages * WALLET_PAGE_SIZE && (
              <div className="flex justify-center">
                <Button variant="outline" className="rounded-full" onClick={() => setPages((count) => count + 1)}>
                  {tActions("loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
