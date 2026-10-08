const mongoose = require('mongoose');

const Schema = mongoose.Schema;

/*
 * Module 3 (notes marketplace): the right of a user to a document. One per (buyer, document), unique.
 * - kind PURCHASE: a premium document bought with tokens (see service/walletService.js for the steps);
 * - kind FREE: created the first time a user downloads a free document (it lets them review it).
 * state: PENDING (tokens held, not confirmed yet) → PAID (buyer charged: access granted) → COMPLETED (author
 * credited, ledger written). FREE acquisitions are COMPLETED at once. Only PAID / COMPLETED grant access.
 */
const KINDS = ['PURCHASE', 'FREE'];
const PURCHASE_STATES = ['PENDING', 'PAID', 'COMPLETED'];
const ACCESS_STATES = ['PAID', 'COMPLETED'];

const purchaseSchema = new Schema(
  {
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    document: { type: Schema.Types.ObjectId, ref: 'MarketDocument', required: true },
    // Author of the document when it was bought (credited with the price).
    seller: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    kind: { type: String, enum: KINDS, required: true },
    price: { type: Number, required: true, min: 0 },
    state: { type: String, enum: PURCHASE_STATES, required: true },
    // Copy of the title (wallet history and notifications survive a deletion).
    documentTitle: { type: String, default: '' },
    // Balance of the buyer right after the debit (ledger entry, also written by the recovery job).
    buyerBalanceAfter: { type: Number, default: null },
    completedAt: { type: Date, default: null },
    // Downloads of this user: the first one counts in MarketDocument.downloads.
    firstDownloadAt: { type: Date, default: null },
    lastDownloadAt: { type: Date, default: null },
    downloadCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => ({
        id: String(ret._id),
        documentId: String(ret.document),
        kind: ret.kind,
        price: ret.price,
        state: ret.state,
        createdAt: ret.createdAt,
      }),
    },
  }
);

// One right per user and document: a second purchase (even concurrent) fails with a duplicate key.
purchaseSchema.index({ buyer: 1, document: 1 }, { unique: true });
purchaseSchema.index({ document: 1, kind: 1 });
purchaseSchema.index({ buyer: 1, state: 1, createdAt: -1 });
// Recovery job: purchases left PENDING / PAID by an interrupted request.
purchaseSchema.index({ state: 1, createdAt: 1 });

const MarketPurchase = mongoose.model('MarketPurchase', purchaseSchema);

module.exports = MarketPurchase;
module.exports.KINDS = KINDS;
module.exports.PURCHASE_STATES = PURCHASE_STATES;
module.exports.ACCESS_STATES = ACCESS_STATES;
