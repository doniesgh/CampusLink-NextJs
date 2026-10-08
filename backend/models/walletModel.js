const mongoose = require('mongoose');

const Schema = mongoose.Schema;

/*
 * Module 3 (notes marketplace): fictitious tokens of a user. Created on first use with MARKET_STARTING_TOKENS.
 * The balance only changes through atomic conditional updates (service/walletService.js) and never goes below 0.
 * `pending` lists the purchases being applied to this wallet (a hold on the buyer's side, a credit marker on the
 * seller's side): it makes every step idempotent and lets the recovery job finish or undo an interrupted purchase.
 */
const OPERATION_KINDS = ['DEBIT', 'CREDIT'];

const pendingSchema = new Schema(
  {
    // MarketPurchase id.
    op: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: OPERATION_KINDS, required: true },
    amount: { type: Number, required: true, min: 0 },
    // DEBIT: the document being bought (one hold per buyer and document at a time).
    document: { type: Schema.Types.ObjectId, default: null },
    at: { type: Date, required: true },
    // DEBIT: the purchase document was written and the hold confirmed (the recovery job never refunds it).
    confirmed: { type: Boolean, default: false },
  },
  { _id: false }
);

const walletSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    balance: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isInteger, message: 'balance must be an integer' },
    },
    pending: { type: [pendingSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => ({ id: String(ret._id), balance: ret.balance, updatedAt: ret.updatedAt }),
    },
  }
);

walletSchema.index({ user: 1 }, { unique: true });
// Recovery job: holds and credits older than the timeout.
walletSchema.index({ 'pending.at': 1 }, { sparse: true });

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;
module.exports.OPERATION_KINDS = OPERATION_KINDS;
