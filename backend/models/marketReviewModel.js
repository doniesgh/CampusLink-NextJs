const mongoose = require('mongoose');
const { idOf, isPopulated } = require('../utils/serialize');

const Schema = mongoose.Schema;

// Module 3 (notes marketplace): one review per user and document (1-5 stars + optional comment), editable.
const MIN_RATING = 1;
const MAX_RATING = 5;
const COMMENT_MAX_LENGTH = 1000;

const authorSnapshotSchema = new Schema(
  {
    firstname: { type: String, default: '' },
    lastname: { type: String, default: '' },
  },
  { _id: false }
);

const reviewSchema = new Schema(
  {
    document: { type: Schema.Types.ObjectId, ref: 'MarketDocument', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorSnapshot: { type: authorSnapshotSchema, default: () => ({}) },
    rating: {
      type: Number,
      required: true,
      min: MIN_RATING,
      max: MAX_RATING,
      validate: { validator: Number.isInteger, message: 'rating must be an integer' },
    },
    // Plain text, line breaks kept.
    comment: { type: String, trim: true, maxlength: COMMENT_MAX_LENGTH, default: '' },
    editedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: { transform: (doc) => serializeReview(doc) },
  }
);

reviewSchema.index({ document: 1, author: 1 }, { unique: true });
reviewSchema.index({ document: 1, createdAt: -1 });

// A deleted account keeps its id (the names then come from the snapshot).
const REVIEW_POPULATE = [
  { path: 'author', select: 'firstname lastname', transform: (found, id) => found ?? { _id: id, firstname: null, lastname: null } },
];

// { id, documentId, author: { id, firstname, lastname }, rating, comment, createdAt, updatedAt, editedAt }
function serializeReview(doc) {
  const authorId = idOf(doc.author);
  let author = null;
  if (authorId) {
    const snapshot = doc.authorSnapshot ?? {};
    const source = isPopulated(doc.author) ? doc.author : {};
    author = {
      id: authorId,
      firstname: source.firstname ?? snapshot.firstname ?? '',
      lastname: source.lastname ?? snapshot.lastname ?? '',
    };
  }
  return {
    id: String(doc._id),
    documentId: String(idOf(doc.document)),
    author,
    rating: doc.rating,
    comment: doc.comment ?? '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    editedAt: doc.editedAt ?? null,
  };
}

const MarketReview = mongoose.model('MarketReview', reviewSchema);

module.exports = MarketReview;
module.exports.MIN_RATING = MIN_RATING;
module.exports.MAX_RATING = MAX_RATING;
module.exports.COMMENT_MAX_LENGTH = COMMENT_MAX_LENGTH;
module.exports.REVIEW_POPULATE = REVIEW_POPULATE;
module.exports.serializeReview = serializeReview;
