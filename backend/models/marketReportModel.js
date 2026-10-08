const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// Module 3 (notes marketplace): a user's report of a published document, handled by ADMINs.
const STATUSES = ['OPEN', 'RESOLVED'];
// UNPUBLISHED: the document was unpublished (by the unpublish action or before the report was resolved);
// NO_ACTION: dismissed.
const OUTCOMES = ['UNPUBLISHED', 'NO_ACTION'];
const REASON_MIN_LENGTH = 5;
const REASON_MAX_LENGTH = 500;
const NOTE_MAX_LENGTH = 500;

const reportSchema = new Schema(
  {
    document: { type: Schema.Types.ObjectId, ref: 'MarketDocument', required: true },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true, minlength: REASON_MIN_LENGTH, maxlength: REASON_MAX_LENGTH },
    status: { type: String, enum: STATUSES, default: 'OPEN' },
    outcome: { type: String, enum: [...OUTCOMES, null], default: null },
    note: { type: String, trim: true, maxlength: NOTE_MAX_LENGTH, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      // What the reporter gets back; ADMINs get the detailed shape built by service/marketplaceService.js.
      transform: (doc, ret) => ({
        id: String(ret._id),
        documentId: String(ret.document),
        reason: ret.reason,
        status: ret.status,
        createdAt: ret.createdAt,
      }),
    },
  }
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ document: 1, status: 1 });
// One open report per user and document (reporting again returns it).
reportSchema.index({ reporter: 1, document: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });

const MarketReport = mongoose.model('MarketReport', reportSchema);

module.exports = MarketReport;
module.exports.STATUSES = STATUSES;
module.exports.OUTCOMES = OUTCOMES;
module.exports.REASON_MIN_LENGTH = REASON_MIN_LENGTH;
module.exports.REASON_MAX_LENGTH = REASON_MAX_LENGTH;
module.exports.NOTE_MAX_LENGTH = NOTE_MAX_LENGTH;
