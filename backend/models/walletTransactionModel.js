const mongoose = require('mongoose');

const Schema = mongoose.Schema;

/*
 * Module 3 (notes marketplace): ledger of a wallet (append-only). `amount` is signed (+ credit, - debit) and
 * `balanceAfter` is the balance right after the operation. `key` makes each entry idempotent:
 * "start:<userId>" (starting tokens), "purchase:<purchaseId>" (buyer), "sale:<purchaseId>" (author).
 */
const TYPES = ['STARTING_BONUS', 'PURCHASE', 'SALE'];

const transactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: TYPES, required: true },
    amount: {
      type: Number,
      required: true,
      validate: { validator: Number.isInteger, message: 'amount must be an integer' },
    },
    balanceAfter: { type: Number, default: null },
    document: { type: Schema.Types.ObjectId, ref: 'MarketDocument', default: null },
    // Copy of the document title (the history stays readable after a deletion).
    documentTitle: { type: String, default: null },
    purchase: { type: Schema.Types.ObjectId, ref: 'MarketPurchase', default: null },
    key: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      // { id, type, amount, balanceAfter, document: { id, title } | null, createdAt }
      transform: (doc, ret) => ({
        id: String(ret._id),
        type: ret.type,
        amount: ret.amount,
        balanceAfter: ret.balanceAfter ?? null,
        document: ret.document ? { id: String(ret.document), title: ret.documentTitle ?? '' } : null,
        createdAt: ret.createdAt,
      }),
    },
  }
);

transactionSchema.index({ key: 1 }, { unique: true });
transactionSchema.index({ user: 1, createdAt: -1, _id: -1 });

const WalletTransaction = mongoose.model('WalletTransaction', transactionSchema);

module.exports = WalletTransaction;
module.exports.TYPES = TYPES;
