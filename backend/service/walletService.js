const mongoose = require('mongoose');
const Wallet = require('../models/walletModel');
const WalletTransaction = require('../models/walletTransactionModel');
const MarketPurchase = require('../models/marketPurchaseModel');
const MarketDocument = require('../models/marketDocumentModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const { envString, envNumber } = require('../utils/env');
const { idOf } = require('../utils/serialize');
const { notifyUsersInBackground } = require('./notificationService');
const scheduler = require('./scheduler');

/*
 * Wallets of the notes marketplace (phase 3 contract section 3): fictitious tokens, purchases and ledger.
 * MongoDB runs without a replica set (no multi-document transaction), so a purchase is a sequence of atomic
 * single-document steps, each of them idempotent:
 *
 *   1. debit the buyer: findOneAndUpdate({ user, balance >= price, no hold for this document }, $inc -price,
 *      $push hold { op, DEBIT, document }) → never a negative balance; nothing matched → 409 INSUFFICIENT_TOKENS
 *      (or ALREADY_PURCHASED when this document is already bought or being bought);
 *   2. insert MarketPurchase { _id: op, state: PENDING }, unique (buyer, document)
 *      → duplicate key: the hold is refunded (conditional $pull + $inc) → 409 ALREADY_PURCHASED (no double charge);
 *   3. confirm the hold (only an unconfirmed hold is ever refunded), purchase → PAID (access granted);
 *   4. ledger PURCHASE (key "purchase:<op>"), credit the author once: findOneAndUpdate({ user, pending.op != op },
 *      $inc +price, $push marker { op, CREDIT }), ledger SALE (key "sale:<op>"), purchase → COMPLETED, buyer hold
 *      removed. The author's CREDIT marker is removed later by the job (after MARKET_HOLD_TIMEOUT_MS), so a late
 *      second completion can never credit twice.
 *
 * The job "marketplace.purchases-recover" finishes or undoes what an interrupted request left behind (PAID
 * purchases not completed, PENDING purchases, holds without purchase) once it is older than MARKET_HOLD_TIMEOUT_MS.
 */

const DEFAULT_STARTING_TOKENS = 100;
const DEFAULT_HOLD_TIMEOUT_MS = 2 * 60 * 1000;
const RECOVERY_BATCH = 50;

const toObjectId = (value) => new mongoose.Types.ObjectId(String(idOf(value)));
const isDuplicateKey = (error) => error?.code === 11000;

// MARKET_STARTING_TOKENS (default 100); 0 is allowed.
const startingTokens = () => {
  const text = envString('MARKET_STARTING_TOKENS', '');
  const value = Number(text);
  return text !== '' && Number.isInteger(value) && value >= 0 ? value : DEFAULT_STARTING_TOKENS;
};

// Age after which the recovery job takes over an unfinished purchase (MARKET_HOLD_TIMEOUT_MS, default 2 min).
const holdTimeoutMs = () => envNumber('MARKET_HOLD_TIMEOUT_MS', DEFAULT_HOLD_TIMEOUT_MS);

const alreadyPurchased = () => new HttpError(409, 'ALREADY_PURCHASED', 'You already bought this document');

// Idempotent ledger entry (unique key): concurrent or repeated calls write it once.
const recordEntry = async (key, fields) => {
  try {
    await WalletTransaction.updateOne({ key }, { $setOnInsert: { ...fields, key } }, { upsert: true });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
};

/**
 * The wallet of a user, created on first use with MARKET_STARTING_TOKENS (+ a STARTING_BONUS ledger entry).
 * Safe under concurrency (one wallet per user, unique index).
 * @returns {Promise<object>} lean wallet
 */
const ensureWallet = async (userId) => {
  const user = toObjectId(userId);
  const existing = await Wallet.findOne({ user }).lean();
  if (existing) return existing;

  const start = startingTokens();
  let result;
  try {
    result = await Wallet.findOneAndUpdate(
      { user },
      { $setOnInsert: { balance: start, pending: [] } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true, lean: true }
    );
  } catch (error) {
    // Two first uses at the same time: the other request created it.
    if (!isDuplicateKey(error)) throw error;
    return Wallet.findOne({ user }).lean();
  }
  const wallet = result.value;
  if (!result.lastErrorObject?.updatedExisting && start > 0) {
    await recordEntry(`start:${user}`, { user, type: 'STARTING_BONUS', amount: start, balanceAfter: start });
  }
  return wallet;
};

/**
 * GET /wallet: balance and ledger (newest first).
 * @returns {{ balance, transactions, total }}
 */
const getWallet = async (userId, { skip = 0, limit = 20 } = {}) => {
  const wallet = await ensureWallet(userId);
  const filter = { user: wallet.user };
  const [transactions, total] = await Promise.all([
    WalletTransaction.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    WalletTransaction.countDocuments(filter),
  ]);
  return { balance: wallet.balance, transactions, total };
};

const balanceOf = async (userId) => (await ensureWallet(userId)).balance;

// Refunds a hold that was never confirmed (the purchase document was not written). Idempotent: true when this call
// refunded it.
const refundHold = async (userId, op) => {
  const wallet = await Wallet.findOne({ user: userId, pending: { $elemMatch: { op, kind: 'DEBIT', confirmed: false } } })
    .select('pending.$')
    .lean();
  const hold = wallet?.pending?.[0];
  if (!hold) return false;
  const result = await Wallet.updateOne(
    { user: userId, pending: { $elemMatch: { op, kind: 'DEBIT', confirmed: false, amount: hold.amount } } },
    { $inc: { balance: hold.amount }, $pull: { pending: { op, kind: 'DEBIT' } } }
  );
  return result.modifiedCount > 0;
};

const removeMarker = (userId, op, kind) =>
  Wallet.updateOne({ user: userId }, { $pull: { pending: { op, kind } } }, { timestamps: false });

// "3 jetons" / "1 token".
const tokens = (locale, count) => {
  const plural = count > 1 ? 's' : '';
  return locale === 'fr' ? `${count} jeton${plural}` : `${count} token${plural}`;
};

// The author learns that one of their documents was sold (the buyer is not named). FR uses "tu".
const notifySale = (purchase) => {
  const title = String(purchase.documentTitle || '').slice(0, 120);
  const documentId = String(purchase.document);
  notifyUsersInBackground([purchase.seller], (locale) => {
    const fr = locale === 'fr';
    return {
      type: 'MARKETPLACE',
      title: fr ? `Nouvelle vente : « ${title} »` : `New sale: "${title}"`,
      body: fr
        ? `Quelqu’un a acheté ton document : +${tokens('fr', purchase.price)}.`
        : `Someone bought your document: +${tokens('en', purchase.price)}.`,
      link: `/dashboard/marketplace/${documentId}`,
      data: { kind: 'SALE', documentId, price: purchase.price },
      tag: `marketplace-sale-${documentId}`,
    };
  });
};

// Credits the author of a PAID purchase exactly once (+ SALE ledger entry). The marker { op, CREDIT } stays on the
// author's wallet until the recovery job removes it, so a concurrent or late second completion never credits again.
const creditSeller = async (purchase) => {
  if (!purchase.seller || purchase.price <= 0 || !(await User.exists({ _id: purchase.seller }))) return;
  const op = purchase._id;
  await ensureWallet(purchase.seller);
  let wallet = await Wallet.findOneAndUpdate(
    { user: purchase.seller, 'pending.op': { $ne: op } },
    {
      $inc: { balance: purchase.price },
      $push: { pending: { op, kind: 'CREDIT', amount: purchase.price, at: new Date(), confirmed: true } },
    },
    { returnDocument: 'after' }
  ).lean();
  // Already credited by an earlier (interrupted) completion: the ledger keeps the current balance.
  wallet ??= await Wallet.findOne({ user: purchase.seller }).lean();
  await recordEntry(`sale:${op}`, {
    user: purchase.seller,
    type: 'SALE',
    amount: purchase.price,
    balanceAfter: wallet ? wallet.balance : null,
    document: purchase.document,
    documentTitle: purchase.documentTitle,
    purchase: op,
  });
};

/**
 * Finishes a PAID purchase: buyer ledger entry, author credit (exactly once) + ledger entry, COMPLETED, hold removed.
 * Idempotent and safe to run concurrently (request + recovery job). Notifies the author once.
 * @returns {Promise<object|null>} the purchase (lean)
 */
const completePurchase = async (purchaseId) => {
  const purchase = await MarketPurchase.findById(purchaseId).lean();
  if (purchase?.kind !== 'PURCHASE' || purchase.state === 'PENDING') return purchase;
  const op = purchase._id;

  if (purchase.state === 'PAID') {
    await recordEntry(`purchase:${op}`, {
      user: purchase.buyer,
      type: 'PURCHASE',
      amount: -purchase.price,
      balanceAfter: purchase.buyerBalanceAfter,
      document: purchase.document,
      documentTitle: purchase.documentTitle,
      purchase: op,
    });
    await creditSeller(purchase);
    const completed = await MarketPurchase.findOneAndUpdate(
      { _id: op, state: 'PAID' },
      { $set: { state: 'COMPLETED', completedAt: new Date() } },
      { returnDocument: 'after' }
    ).lean();
    if (completed) {
      await MarketDocument.updateOne({ _id: purchase.document }, { $inc: { sales: 1 } }, { timestamps: false });
      if (purchase.seller && purchase.price > 0) notifySale(purchase);
    }
  }

  await removeMarker(purchase.buyer, op, 'DEBIT');
  return MarketPurchase.findById(op).lean();
};

/**
 * Buys a published premium document (the caller checked: visible, PUBLISHED, price > 0, not the author).
 * @param {{ buyer: object, document: object }} params  buyer = req.user, document = lean MarketDocument
 * @returns {Promise<{ purchase: object, balance: number }>}
 *          409 ALREADY_PURCHASED | INSUFFICIENT_TOKENS (details { balance, price })
 */
const purchase = async ({ buyer, document }) => {
  const buyerId = toObjectId(buyer);
  const documentId = toObjectId(document);
  const { price } = document;
  if (await MarketPurchase.exists({ buyer: buyerId, document: documentId })) throw alreadyPurchased();

  const sellerId = document.author ? toObjectId(document.author) : null;
  const sellerExists = sellerId ? Boolean(await User.exists({ _id: sellerId })) : false;
  await ensureWallet(buyerId);
  if (sellerExists) await ensureWallet(sellerId);

  // 1. Atomic conditional debit with a hold: never below 0, and one hold per buyer and document at a time (parallel
  // duplicates of one purchase never hold the tokens twice).
  const op = new mongoose.Types.ObjectId();
  const debited = await Wallet.findOneAndUpdate(
    { user: buyerId, balance: { $gte: price }, 'pending.document': { $ne: documentId } },
    {
      $inc: { balance: -price },
      $push: { pending: { op, kind: 'DEBIT', amount: price, document: documentId, at: new Date(), confirmed: false } },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!debited) {
    const [wallet, bought] = await Promise.all([
      Wallet.findOne({ user: buyerId }).lean(),
      MarketPurchase.exists({ buyer: buyerId, document: documentId }),
    ]);
    const inProgress = (wallet?.pending ?? []).some((hold) => hold.kind === 'DEBIT' && String(hold.document) === String(documentId));
    if (bought || inProgress) throw alreadyPurchased();
    throw new HttpError(409, 'INSUFFICIENT_TOKENS', 'Not enough tokens to buy this document', {
      balance: wallet?.balance ?? 0,
      price,
    });
  }

  // 2. The unique (buyer, document) purchase: a duplicate refunds the hold (no double charge).
  try {
    await MarketPurchase.create({
      _id: op,
      buyer: buyerId,
      document: documentId,
      seller: sellerExists ? sellerId : null,
      kind: 'PURCHASE',
      price,
      state: 'PENDING',
      documentTitle: document.title,
      buyerBalanceAfter: debited.balance,
    });
  } catch (error) {
    await refundHold(buyerId, op);
    if (isDuplicateKey(error)) throw alreadyPurchased();
    throw error;
  }

  // 3. Confirm the hold. If the recovery job refunded it meanwhile (request stalled longer than the timeout), undo.
  const confirmed = await Wallet.updateOne(
    { user: buyerId, pending: { $elemMatch: { op, kind: 'DEBIT', confirmed: false } } },
    { $set: { 'pending.$.confirmed': true } }
  );
  if (confirmed.modifiedCount === 0) {
    await MarketPurchase.deleteOne({ _id: op, state: 'PENDING' });
    throw new HttpError(409, 'INVALID_STATE', 'The purchase took too long, please try again');
  }
  await MarketPurchase.updateOne({ _id: op, state: 'PENDING' }, { $set: { state: 'PAID' } });

  // 4. Ledger, author credit, completion. A failure here is finished later by the recovery job.
  let record = null;
  try {
    record = await completePurchase(op);
  } catch (error) {
    console.error(`[marketplace] Could not complete purchase ${op}:`, error.message);
  }
  record ??= await MarketPurchase.findById(op).lean();
  return { purchase: MarketPurchase.hydrate(record).toJSON(), balance: debited.balance };
};

// ---------- Recovery job ----------

// A PENDING purchase older than the timeout: refund an unconfirmed hold (and drop the purchase), or go on with a
// confirmed one.
const recoverPendingPurchase = async (item, report) => {
  if (await refundHold(item.buyer, item._id)) {
    report.refunded += 1;
    await MarketPurchase.deleteOne({ _id: item._id, state: 'PENDING' });
    report.dropped += 1;
    return;
  }
  const confirmedHold = await Wallet.exists({ user: item.buyer, pending: { $elemMatch: { op: item._id, confirmed: true } } });
  if (!confirmedHold) {
    await MarketPurchase.deleteOne({ _id: item._id, state: 'PENDING' });
    report.dropped += 1;
    return;
  }
  await MarketPurchase.updateOne({ _id: item._id, state: 'PENDING' }, { $set: { state: 'PAID' } });
  await completePurchase(item._id);
  report.completed += 1;
};

// A wallet hold (DEBIT) or credit marker (CREDIT) older than the timeout.
const recoverWalletEntry = async (wallet, entry, cutoff, report) => {
  const item = await MarketPurchase.findById(entry.op).select('state completedAt').lean();
  if (item?.state === 'PAID') {
    await completePurchase(entry.op);
    report.completed += 1;
    return;
  }
  if (entry.kind === 'DEBIT') {
    if (item?.state === 'PENDING') return; // handled with the PENDING purchases
    if (!item && !entry.confirmed) {
      if (await refundHold(wallet.user, entry.op)) report.refunded += 1;
      return;
    }
    if (!item) console.warn(`[marketplace] Confirmed hold ${entry.op} without purchase removed (no refund).`);
    await removeMarker(wallet.user, entry.op, 'DEBIT');
    report.markersRemoved += 1;
    return;
  }
  // CREDIT: kept until the purchase has been COMPLETED for longer than the timeout.
  if (!item || (item.state === 'COMPLETED' && item.completedAt && item.completedAt < cutoff)) {
    await removeMarker(wallet.user, entry.op, 'CREDIT');
    report.markersRemoved += 1;
  }
};

// Runs one recovery step and logs its failure (the next run retries).
const attempt = async (label, fn) => {
  try {
    await fn();
  } catch (error) {
    console.error(`[marketplace] Recovery of ${label} failed:`, error.message);
  }
};

/**
 * Recovery job: finishes or undoes purchases left behind by interrupted requests (older than MARKET_HOLD_TIMEOUT_MS),
 * and removes the author credit markers of completed purchases. Returns counters (for logs and tests).
 */
const recoverPurchases = async ({ now = new Date() } = {}) => {
  const cutoff = new Date(now.getTime() - holdTimeoutMs());
  const report = { completed: 0, refunded: 0, dropped: 0, markersRemoved: 0 };

  const pendingPurchases = await MarketPurchase.find({ kind: 'PURCHASE', state: 'PENDING', createdAt: { $lt: cutoff } })
    .limit(RECOVERY_BATCH)
    .lean();
  for (const item of pendingPurchases) {
    await attempt(`purchase ${item._id}`, () => recoverPendingPurchase(item, report));
  }

  const paidPurchases = await MarketPurchase.find({ kind: 'PURCHASE', state: 'PAID', updatedAt: { $lt: cutoff } })
    .select('_id')
    .limit(RECOVERY_BATCH)
    .lean();
  for (const item of paidPurchases) {
    await attempt(`purchase ${item._id}`, async () => {
      await completePurchase(item._id);
      report.completed += 1;
    });
  }

  const wallets = await Wallet.find({ 'pending.at': { $lt: cutoff } }).limit(RECOVERY_BATCH).lean();
  for (const wallet of wallets) {
    for (const entry of wallet.pending.filter((pending) => pending.at < cutoff)) {
      await attempt(`wallet operation ${entry.op}`, () => recoverWalletEntry(wallet, entry, cutoff, report));
    }
  }
  return report;
};

scheduler.registerJob('marketplace.purchases-recover', Math.max(scheduler.defaultIntervalMs(), 5000), async () => {
  const report = await recoverPurchases();
  if (report.completed || report.refunded || report.dropped) {
    console.log(`[marketplace] Recovered purchases: ${JSON.stringify(report)}`);
  }
});

module.exports = {
  startingTokens,
  holdTimeoutMs,
  ensureWallet,
  getWallet,
  balanceOf,
  purchase,
  completePurchase,
  recoverPurchases,
  recordEntry,
};
