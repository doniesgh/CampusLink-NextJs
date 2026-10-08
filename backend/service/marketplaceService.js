const mongoose = require('mongoose');
const MarketDocument = require('../models/marketDocumentModel');
const MarketPurchase = require('../models/marketPurchaseModel');
const MarketReview = require('../models/marketReviewModel');
const MarketReport = require('../models/marketReportModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const { notFound } = require('../utils/validation');
const { idOf, isPopulated } = require('../utils/serialize');
const storageService = require('./storageService');
const walletService = require('./walletService');
const { notifyUsersInBackground } = require('./notificationService');

/*
 * Business rules of Module 3 (notes marketplace), phase 3 contract section 3: visibility, upload and edits,
 * moderation (review queue, reports, unpublish) with MARKETPLACE notifications, downloads (authorization and
 * counter), purchases (service/walletService.js), reviews and search.
 * HTTP parsing and audit live in controllers/marketplaceController.js. Functions take the signed-in user (req.user).
 */

const { DOCUMENT_POPULATE, serializeDocument } = MarketDocument;
const { REVIEW_POPULATE, serializeReview } = MarketReview;
const { ACCESS_STATES } = MarketPurchase;

const STORAGE_FOLDER = 'marketplace';
// The admins get at most one "new document to review" notification per author in this window.
const REVIEW_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_RETRIES = 5;
const TITLE_EXCERPT = 120;

const forbidden = (message = 'You do not have permission to perform this action', details) =>
  new HttpError(403, 'FORBIDDEN', message, details);
const invalidState = (message, details) => new HttpError(409, 'INVALID_STATE', message, details);
const isDuplicateKey = (error) => error?.code === 11000;
const sameId = (a, b) => {
  const left = idOf(a);
  const right = idOf(b);
  return Boolean(left) && left === right;
};
const isAdmin = (user) => user?.role === 'ADMIN';
const isAuthor = (user, doc) => Boolean(user) && sameId(doc.author, user);
const excerpt = (text, max = TITLE_EXCERPT) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

// ---------- Visibility ----------

// PUBLISHED documents are visible to every signed-in user; the others only to their author and ADMINs.
const canSee = (user, doc) => doc.status === 'PUBLISHED' || isAdmin(user) || isAuthor(user, doc);

// The document, or 404 RESOURCE_NOT_FOUND when it does not exist or the user may not see it (same answer).
const findVisibleDocument = async (user, id, { populate = false } = {}) => {
  const query = MarketDocument.findById(id);
  if (populate) query.populate(DOCUMENT_POPULATE);
  const doc = await query.lean();
  if (!doc || doc.deleting || !canSee(user, doc)) throw notFound('Document');
  return doc;
};

// Ids (strings) of the documents the user holds a right to (bought, or downloaded when free).
const acquiredIds = async (user, documentIds) => {
  if (documentIds.length === 0) return new Set();
  const rows = await MarketPurchase.find({
    buyer: user._id,
    document: { $in: documentIds },
    state: { $in: ACCESS_STATES },
  })
    .select('document')
    .lean();
  return new Set(rows.map((row) => String(row.document)));
};

const hasAccess = async (user, doc) =>
  Boolean(await MarketPurchase.exists({ buyer: user._id, document: doc._id, state: { $in: ACCESS_STATES } }));

// Download rule: author and ADMIN always; others only a PUBLISHED document, free or acquired.
const canDownload = (user, doc, acquired) =>
  isAdmin(user) || isAuthor(user, doc) || (doc.status === 'PUBLISHED' && (doc.price === 0 || acquired));

// Reviews: PUBLISHED, not the author, and downloaded (free) or bought (premium).
const canReview = (user, doc, acquired) => doc.status === 'PUBLISHED' && !isAuthor(user, doc) && acquired;

/**
 * Document JSON with the viewer fields: `purchased` (the viewer bought it, or downloaded it when free), `mine`,
 * `canDownload` (+ `canReview` with { detail: true }).
 */
const presentDocuments = async (user, docs, { detail = false } = {}) => {
  const acquired = await acquiredIds(
    user,
    docs.map((doc) => doc._id)
  );
  return docs.map((doc) => {
    const owned = acquired.has(String(doc._id));
    const viewer = { purchased: owned, mine: isAuthor(user, doc), canDownload: canDownload(user, doc, owned) };
    if (detail) viewer.canReview = canReview(user, doc, owned);
    return serializeDocument(doc, viewer);
  });
};

const loadPopulated = (id) => MarketDocument.findById(id).populate(DOCUMENT_POPULATE).lean();

const presentDocument = async (user, docOrId, options) => {
  const doc = isPopulated(docOrId) && isPopulated(docOrId.subject) ? docOrId : await loadPopulated(idOf(docOrId));
  if (!doc) throw notFound('Document');
  return (await presentDocuments(user, [doc], options))[0];
};

// ---------- Notifications (type MARKETPLACE, recipient's locale, French uses "tu") ----------

const documentLink = (id) => `/dashboard/marketplace/${id}`;

const notifyAuthor = (doc, kind, reason = null) => {
  if (!doc.author) return;
  const title = excerpt(doc.title);
  const id = String(doc._id);
  notifyUsersInBackground([idOf(doc.author)], (locale) => {
    const fr = locale === 'fr';
    const texts = {
      PUBLISHED: fr
        ? [`Ton document est publié : « ${title} »`, 'Il est maintenant visible dans la marketplace.']
        : [`Your document is published: "${title}"`, 'It is now visible in the marketplace.'],
      REJECTED: fr
        ? [`Ton document a été refusé : « ${title} »`, `Motif : ${reason}. Tu peux le modifier et le proposer à nouveau.`]
        : [`Your document was rejected: "${title}"`, `Reason: ${reason}. You can edit it and submit it again.`],
      UNPUBLISHED: fr
        ? [
            `Ton document a été retiré : « ${title} »`,
            reason ? `Motif : ${reason}` : 'L’équipe de modération l’a retiré de la marketplace.',
          ]
        : [
            `Your document was unpublished: "${title}"`,
            reason ? `Reason: ${reason}` : 'The moderation team removed it from the marketplace.',
          ],
    }[kind];
    return {
      type: 'MARKETPLACE',
      title: texts[0],
      body: texts[1],
      link: documentLink(id),
      data: { kind, documentId: id, status: kind },
      tag: `marketplace-document-${id}`,
    };
  });
};

// Every ADMIN (except the author) learns that a document waits for a review; at most once per author and
// REVIEW_NOTIFY_COOLDOWN_MS (the others wait in the queue). Best effort.
const notifyReviewQueue = async (doc, author) => {
  const since = new Date(Date.now() - REVIEW_NOTIFY_COOLDOWN_MS);
  const recent = await MarketDocument.exists({ author: doc.author, _id: { $ne: doc._id }, reviewNotifiedAt: { $gte: since } });
  if (recent) return;
  const claimed = await MarketDocument.updateOne(
    { _id: doc._id, status: 'PENDING_REVIEW' },
    { $set: { reviewNotifiedAt: new Date() } },
    { timestamps: false }
  );
  if (claimed.modifiedCount === 0) return;
  const admins = await User.find({ role: 'ADMIN', _id: { $ne: doc.author } }).select('_id').setOptions({ populateGroup: false }).lean();
  if (admins.length === 0) return;
  const title = excerpt(doc.title);
  const name = `${author.firstname ?? ''} ${author.lastname ?? ''}`.trim();
  const id = String(doc._id);
  notifyUsersInBackground(admins, (locale) => {
    const fr = locale === 'fr';
    return {
      type: 'MARKETPLACE',
      title: fr ? `Nouveau document à vérifier : « ${title} »` : `New document to review: "${title}"`,
      body: fr ? `${name} a proposé un document pour la marketplace.` : `${name} submitted a document to the marketplace.`,
      link: `/dashboard/admin/marketplace?document=${id}`,
      data: { kind: 'REVIEW_REQUEST', documentId: id },
      tag: 'marketplace-review-queue',
    };
  });
};

// ---------- Search ----------

const LIST_SORTS = {
  recent: { publishedAt: -1, createdAt: -1, _id: -1 },
  rating: { rating: -1, ratingCount: -1, publishedAt: -1, _id: -1 },
  popular: { downloads: -1, rating: -1, publishedAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
};
const OWN_RECENT = { createdAt: -1, _id: -1 };

/**
 * Paginated list. Default: PUBLISHED documents. `mine` → the user's documents (any status, `statuses` filters
 * them). `statuses` without `mine` → ADMIN only (review queue). `purchased` → documents the user acquired.
 * `q` uses the text index (title 5, professor 3, description 1); without an explicit sort, results are ordered by
 * relevance.
 */
const listDocuments = async (user, options) => {
  const { q, subject, level, type, professor, academicYear, free, sort, mine, purchased, statuses, author, skip, limit } =
    options;
  const filter = { deleting: { $ne: true } };
  const own = Boolean(mine);
  if (own) {
    filter.author = user._id;
    if (statuses) filter.status = { $in: statuses };
  } else if (statuses) {
    if (!isAdmin(user)) throw forbidden('Only administrators can filter documents by status');
    filter.status = { $in: statuses };
  } else {
    filter.status = 'PUBLISHED';
  }
  if (author) {
    if (own && !sameId(author, user)) return { items: [], total: 0 };
    filter.author = author;
  }
  if (purchased) {
    const ids = await MarketPurchase.distinct('document', { buyer: user._id, state: { $in: ACCESS_STATES } });
    filter._id = { $in: ids };
  }
  if (q) filter.$text = { $search: q };
  if (subject) filter.subject = subject;
  if (level) filter.level = level;
  if (type) filter.type = type;
  if (academicYear) filter.academicYear = academicYear;
  if (professor) filter.professor = { $regex: professor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (free === true) filter.price = 0;
  if (free === false) filter.price = { $gt: 0 };

  const order = sort ?? (q ? 'relevance' : 'recent');
  let sortSpec;
  if (order === 'relevance') sortSpec = q ? { score: { $meta: 'textScore' }, publishedAt: -1, _id: -1 } : LIST_SORTS.recent;
  else if (order === 'recent' && (own || statuses)) sortSpec = OWN_RECENT;
  else sortSpec = LIST_SORTS[order];

  const [items, total] = await Promise.all([
    MarketDocument.find(filter).sort(sortSpec).skip(skip).limit(limit).populate(DOCUMENT_POPULATE).lean(),
    MarketDocument.countDocuments(filter),
  ]);
  return { items: await presentDocuments(user, items), total };
};

const getDocument = async (user, id) => {
  const doc = await findVisibleDocument(user, id, { populate: true });
  return presentDocument(user, doc, { detail: true });
};

// ---------- Upload and edits ----------

/**
 * POST /documents: saves the file (storageService, folder "marketplace") and the document. ADMIN uploads are
 * published at once, the others wait in the review queue (the admins are notified).
 * @param {object} values  parsed fields (title, description, subject, level, academicYear, professor, type, price)
 * @param {{ buffer, originalname, mimetype }} file
 */
const createDocument = async (user, values, file) => {
  const saved = await storageService.save({
    buffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    folder: STORAGE_FOLDER,
  });
  const now = new Date();
  const admin = isAdmin(user);
  let doc;
  try {
    doc = await MarketDocument.create({
      ...values,
      file: saved,
      author: user._id,
      authorSnapshot: { firstname: user.firstname, lastname: user.lastname },
      status: admin ? 'PUBLISHED' : 'PENDING_REVIEW',
      submittedAt: now,
      ...(admin ? { publishedAt: now, reviewedAt: now, reviewedBy: user._id } : {}),
    });
  } catch (error) {
    await storageService.remove(saved.key).catch(() => {});
    throw error;
  }
  if (!admin) {
    notifyReviewQueue(doc, user).catch((error) => console.error('[marketplace] Review notification failed:', error.message));
  }
  return presentDocument(user, doc._id, { detail: true });
};

// Fields an author may change on a PUBLISHED document (the others need a new review).
const PUBLISHED_EDITABLE = ['price'];

/**
 * PATCH /documents/:id (author only). PENDING_REVIEW and REJECTED documents: every field (a REJECTED document goes
 * back to the review queue). PUBLISHED: only the price (ADMIN authors: every field). UNPUBLISHED: nothing
 * (409 INVALID_STATE), except for an ADMIN author.
 */
const updateDocument = async (user, id, values) => {
  const doc = await findVisibleDocument(user, id);
  if (!isAuthor(user, doc)) throw forbidden('Only the author can edit this document');
  const admin = isAdmin(user);
  const fields = Object.keys(values);
  if (!admin && doc.status === 'UNPUBLISHED') {
    throw invalidState('An unpublished document cannot be edited', { status: doc.status });
  }
  if (!admin && doc.status === 'PUBLISHED') {
    const locked = fields.filter((field) => !PUBLISHED_EDITABLE.includes(field));
    if (locked.length > 0) {
      throw invalidState('Only the price of a published document can be changed', { status: doc.status, fields: locked });
    }
  }
  const set = { ...values };
  const resubmitted = !admin && doc.status === 'REJECTED';
  if (resubmitted) Object.assign(set, { status: 'PENDING_REVIEW', submittedAt: new Date(), rejectionReason: null });

  const updated = await MarketDocument.findOneAndUpdate(
    { _id: doc._id, status: doc.status, deleting: { $ne: true } },
    { $set: set },
    { returnDocument: 'after', runValidators: true }
  ).lean();
  if (!updated) throw invalidState('The document changed meanwhile, reload it and try again');
  if (resubmitted) {
    notifyReviewQueue(updated, user).catch((error) => console.error('[marketplace] Review notification failed:', error.message));
  }
  return presentDocument(user, updated._id, { detail: true });
};

/**
 * DELETE /documents/:id (author only): only while nobody bought it (409 IN_USE, details.references.purchases).
 * Removes the file, reviews, reports and free acquisitions. ADMINs unpublish instead.
 */
const deleteDocument = async (user, id) => {
  const doc = await findVisibleDocument(user, id);
  if (!isAuthor(user, doc)) throw forbidden('Only the author can delete this document');
  // Claim: no purchase in flight, none can start afterwards (purchases skip documents being deleted).
  const claimed = await MarketDocument.findOneAndUpdate(
    { _id: doc._id, purchasesInFlight: { $lte: 0 }, deleting: { $ne: true } },
    { $set: { deleting: true } },
    { timestamps: false }
  ).lean();
  if (!claimed) {
    throw new HttpError(409, 'IN_USE', 'A purchase of this document is in progress', { references: { purchases: 1 } });
  }
  const purchases = await MarketPurchase.countDocuments({ document: doc._id, kind: 'PURCHASE' });
  if (purchases > 0) {
    await MarketDocument.updateOne({ _id: doc._id }, { $set: { deleting: false } }, { timestamps: false });
    throw new HttpError(409, 'IN_USE', 'This document was bought: it cannot be deleted', { references: { purchases } });
  }
  await Promise.all([
    MarketReview.deleteMany({ document: doc._id }),
    MarketReport.deleteMany({ document: doc._id }),
    MarketPurchase.deleteMany({ document: doc._id, kind: 'FREE' }),
  ]);
  await MarketDocument.deleteOne({ _id: doc._id });
  await storageService.remove(doc.file.key).catch((error) => console.error('[marketplace] File removal failed:', error.message));
  return doc;
};

// ---------- Download ----------

/**
 * GET /documents/:id/file: checks the rights (404 for anything the user may not download, hidden or not bought),
 * then records the user's first download (counter `downloads`: distinct users, not the author). A free document
 * creates a FREE acquisition (it lets the user review it). { record: false } (HEAD requests) records nothing.
 * @returns {{ key, filename, mimeType }}
 */
const prepareDownload = async (user, id, { record = true } = {}) => {
  const doc = await findVisibleDocument(user, id);
  const acquired = await hasAccess(user, doc);
  if (!canDownload(user, doc, acquired)) throw notFound('Document');
  if (!(await storageService.stat(doc.file.key))) throw notFound('File');

  if (record && doc.status === 'PUBLISHED' && !isAuthor(user, doc) && (acquired || doc.price === 0)) {
    const now = new Date();
    const owner = { buyer: user._id, document: doc._id };
    if (!acquired) {
      try {
        await MarketPurchase.updateOne(
          owner,
          {
            $setOnInsert: {
              kind: 'FREE',
              price: 0,
              state: 'COMPLETED',
              completedAt: now,
              seller: doc.author,
              documentTitle: doc.title,
            },
          },
          { upsert: true }
        );
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    const first = await MarketPurchase.findOneAndUpdate(
      { ...owner, state: { $in: ACCESS_STATES }, firstDownloadAt: null },
      { $set: { firstDownloadAt: now, lastDownloadAt: now }, $inc: { downloadCount: 1 } }
    ).lean();
    if (first) {
      await MarketDocument.updateOne({ _id: doc._id }, { $inc: { downloads: 1 } }, { timestamps: false });
    } else {
      await MarketPurchase.updateOne(
        { ...owner, state: { $in: ACCESS_STATES } },
        { $set: { lastDownloadAt: now }, $inc: { downloadCount: 1 } }
      );
    }
  }
  return { key: doc.file.key, filename: doc.file.filename, mimeType: doc.file.mimeType };
};

// ---------- Purchase ----------

/**
 * POST /documents/:id/purchase { expectedPrice? }: PUBLISHED premium document, not the author, not already bought.
 * The document is reserved (`purchasesInFlight`) so its author cannot delete it during the purchase.
 * @returns {{ purchase, balance, document }}
 */
const purchaseDocument = async (user, id, { expectedPrice } = {}) => {
  const doc = await findVisibleDocument(user, id);
  if (isAuthor(user, doc)) throw forbidden('You cannot buy your own document');
  if (doc.status !== 'PUBLISHED') throw invalidState('Only published documents can be bought', { status: doc.status });

  const reserved = await MarketDocument.findOneAndUpdate(
    { _id: doc._id, status: 'PUBLISHED', deleting: { $ne: true } },
    { $inc: { purchasesInFlight: 1 } },
    { returnDocument: 'after', timestamps: false }
  ).lean();
  if (!reserved) throw notFound('Document');
  try {
    if (reserved.price === 0) throw invalidState('This document is free: download it', { reason: 'FREE_DOCUMENT' });
    if (expectedPrice !== undefined && expectedPrice !== reserved.price) {
      throw new HttpError(409, 'PRICE_CHANGED', 'The price of this document changed', { price: reserved.price });
    }
    const result = await walletService.purchase({ buyer: user, document: reserved });
    return { ...result, document: await presentDocument(user, reserved._id, { detail: true }) };
  } finally {
    await MarketDocument.updateOne({ _id: doc._id }, { $inc: { purchasesInFlight: -1 } }, { timestamps: false });
  }
};

// ---------- Reviews ----------

// rating = round(sum / count, 2), updated atomically with the sum and the count.
const applyRating = (documentId, sumDelta, countDelta) =>
  MarketDocument.updateOne(
    { _id: documentId },
    [
      {
        $set: {
          ratingSum: { $add: [{ $ifNull: ['$ratingSum', 0] }, sumDelta] },
          ratingCount: { $add: [{ $ifNull: ['$ratingCount', 0] }, countDelta] },
        },
      },
      {
        $set: {
          rating: {
            $cond: [{ $gt: ['$ratingCount', 0] }, { $round: [{ $divide: ['$ratingSum', '$ratingCount'] }, 2] }, 0],
          },
        },
      },
    ],
    { updatePipeline: true, timestamps: false }
  );

const reviewDistribution = async (documentId) => {
  const rows = await MarketReview.aggregate([
    { $match: { document: new mongoose.Types.ObjectId(String(documentId)) } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ]);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  rows.forEach((row) => {
    distribution[row._id] = row.count;
  });
  return distribution;
};

/**
 * GET /documents/:id/reviews → { items (newest first), total, myReview, canReview, distribution }.
 */
const listReviews = async (user, id, { skip, limit }) => {
  const doc = await findVisibleDocument(user, id);
  const filter = { document: doc._id };
  const [items, total, mine, acquired, distribution] = await Promise.all([
    MarketReview.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate(REVIEW_POPULATE).lean(),
    MarketReview.countDocuments(filter),
    MarketReview.findOne({ ...filter, author: user._id }).populate(REVIEW_POPULATE).lean(),
    hasAccess(user, doc),
    reviewDistribution(doc._id),
  ]);
  return {
    items: items.map(serializeReview),
    total,
    myReview: mine ? serializeReview(mine) : null,
    canReview: canReview(user, doc, acquired),
    distribution,
  };
};

/**
 * PUT /documents/:id/review { rating, comment }: creates or replaces the user's review (one per user and document).
 * 403 FORBIDDEN (details.reason OWN_DOCUMENT | NOT_ACQUIRED), 409 INVALID_STATE when the document is not published.
 * @returns {{ review, created }}
 */
const saveReview = async (user, id, { rating, comment }) => {
  const doc = await findVisibleDocument(user, id);
  if (isAuthor(user, doc)) throw forbidden('You cannot review your own document', { reason: 'OWN_DOCUMENT' });
  if (doc.status !== 'PUBLISHED') throw invalidState('Only published documents can be reviewed', { status: doc.status });
  if (!(await hasAccess(user, doc))) {
    throw forbidden('Download (free) or buy (premium) this document before reviewing it', { reason: 'NOT_ACQUIRED' });
  }

  const filter = { document: doc._id, author: user._id };
  // User text goes through $literal: a pipeline would read "$..." strings as field paths.
  const update = [
    {
      $set: {
        rating: { $literal: rating },
        comment: { $literal: comment },
        authorSnapshot: { $literal: { firstname: user.firstname ?? '', lastname: user.lastname ?? '' } },
        editedAt: { $cond: [{ $eq: [{ $type: '$createdAt' }, 'missing'] }, null, '$$NOW'] },
        createdAt: { $ifNull: ['$createdAt', '$$NOW'] },
        updatedAt: '$$NOW',
      },
    },
  ];
  let before = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      before = await MarketReview.findOneAndUpdate(filter, update, {
        upsert: true,
        returnDocument: 'before',
        updatePipeline: true,
        timestamps: false,
      }).lean();
      break;
    } catch (error) {
      // Two first reviews at the same time: the upsert that lost retries on the review the other one created.
      if (!isDuplicateKey(error) || attempt >= MAX_RETRIES) throw error;
    }
  }
  if (before) await applyRating(doc._id, rating - before.rating, 0);
  else await applyRating(doc._id, rating, 1);

  const review = await MarketReview.findOne(filter).populate(REVIEW_POPULATE).lean();
  return { review: serializeReview(review), created: !before };
};

// DELETE /documents/:id/review: the user's own review (404 when there is none).
const deleteOwnReview = async (user, id) => {
  const doc = await findVisibleDocument(user, id);
  const removed = await MarketReview.findOneAndDelete({ document: doc._id, author: user._id }).lean();
  if (!removed) throw notFound('Review');
  await applyRating(doc._id, -removed.rating, -1);
};

// ADMIN DELETE /reviews/:id (moderation of an abusive comment). @returns the removed review (lean).
const deleteReview = async (admin, reviewId) => {
  const removed = await MarketReview.findOneAndDelete({ _id: reviewId }).lean();
  if (!removed) throw notFound('Review');
  await applyRating(removed.document, -removed.rating, -1);
  return removed;
};

// ---------- Reports and moderation ----------

/**
 * POST /documents/:id/report { reason }: a PUBLISHED document, not one's own. One open report per user and
 * document (reporting again returns it, { created: false }).
 */
const reportDocument = async (user, id, reason) => {
  const doc = await findVisibleDocument(user, id);
  if (isAuthor(user, doc)) throw forbidden('You cannot report your own document');
  if (doc.status !== 'PUBLISHED') throw invalidState('Only published documents can be reported', { status: doc.status });
  const filter = { reporter: user._id, document: doc._id, status: 'OPEN' };
  const existing = await MarketReport.findOne(filter);
  if (existing) return { report: existing, created: false };
  try {
    return { report: await MarketReport.create({ ...filter, reason }), created: true };
  } catch (error) {
    if (isDuplicateKey(error)) {
      const again = await MarketReport.findOne(filter);
      if (again) return { report: again, created: false };
    }
    throw error;
  }
};

// Atomic status change (compare-and-set on the status that was read). 404 / 409 INVALID_STATE (details.status).
const changeStatus = async (id, allowed, set) => {
  const doc = await MarketDocument.findById(id).lean();
  if (!doc || doc.deleting) throw notFound('Document');
  if (!allowed.includes(doc.status)) {
    throw invalidState(`This action is not possible on a ${doc.status} document`, { status: doc.status });
  }
  const updated = await MarketDocument.findOneAndUpdate(
    { _id: doc._id, status: doc.status, deleting: { $ne: true } },
    { $set: typeof set === 'function' ? set(doc) : set },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) {
    const current = await MarketDocument.findById(id).select('status').lean();
    if (!current) throw notFound('Document');
    throw invalidState('The document changed meanwhile, reload it and try again', { status: current.status });
  }
  return { previous: doc, updated };
};

// ADMIN: PENDING_REVIEW (or UNPUBLISHED, published again) → PUBLISHED. Notifies the author.
const approveDocument = async (admin, id) => {
  const now = new Date();
  const result = await changeStatus(id, ['PENDING_REVIEW', 'UNPUBLISHED'], (doc) => ({
    status: 'PUBLISHED',
    publishedAt: doc.publishedAt ?? now,
    reviewedAt: now,
    reviewedBy: admin._id,
    rejectionReason: null,
    unpublishedAt: null,
  }));
  notifyAuthor(result.updated, 'PUBLISHED');
  return { ...result, document: await presentDocument(admin, result.updated._id, { detail: true }) };
};

// ADMIN: PENDING_REVIEW → REJECTED with a reason (shown to the author). Notifies the author.
const rejectDocument = async (admin, id, reason) => {
  const now = new Date();
  const result = await changeStatus(id, ['PENDING_REVIEW'], {
    status: 'REJECTED',
    rejectionReason: reason,
    reviewedAt: now,
    reviewedBy: admin._id,
  });
  notifyAuthor(result.updated, 'REJECTED', reason);
  return { ...result, document: await presentDocument(admin, result.updated._id, { detail: true }) };
};

// ADMIN: PUBLISHED → UNPUBLISHED (optional reason), resolves the open reports (outcome UNPUBLISHED), notifies the author.
const unpublishDocument = async (admin, id, reason = null) => {
  const now = new Date();
  const result = await changeStatus(id, ['PUBLISHED'], {
    status: 'UNPUBLISHED',
    rejectionReason: reason,
    unpublishedAt: now,
    reviewedAt: now,
    reviewedBy: admin._id,
  });
  const resolved = await MarketReport.updateMany(
    { document: result.updated._id, status: 'OPEN' },
    { $set: { status: 'RESOLVED', outcome: 'UNPUBLISHED', resolvedAt: now, resolvedBy: admin._id } }
  );
  notifyAuthor(result.updated, 'UNPUBLISHED', reason);
  return {
    ...result,
    resolvedReports: resolved.modifiedCount,
    document: await presentDocument(admin, result.updated._id, { detail: true }),
  };
};

const REPORT_POPULATE = [
  { path: 'reporter', select: 'firstname lastname role' },
  { path: 'resolvedBy', select: 'firstname lastname' },
  {
    path: 'document',
    select: 'title status price author authorSnapshot',
    populate: { path: 'author', select: 'firstname lastname', transform: MarketDocument.keepMissingId },
  },
];

const personSummary = (value, fields = ['firstname', 'lastname']) => {
  if (!isPopulated(value)) return idOf(value) ? { id: idOf(value) } : null;
  return { id: String(value._id), ...Object.fromEntries(fields.map((field) => [field, value[field] ?? null])) };
};

// Report JSON for ADMINs.
const presentReport = (report) => {
  const doc = isPopulated(report.document) ? report.document : null;
  return {
    id: String(report._id),
    document: doc
      ? {
          id: String(doc._id),
          title: doc.title,
          status: doc.status,
          price: doc.price,
          author: MarketDocument.summarizeAuthor(doc),
        }
      : null,
    documentId: String(idOf(report.document)),
    reason: report.reason,
    status: report.status,
    outcome: report.outcome ?? null,
    note: report.note ?? null,
    reporter: personSummary(report.reporter, ['firstname', 'lastname', 'role']),
    createdAt: report.createdAt,
    resolvedAt: report.resolvedAt ?? null,
    resolvedBy: personSummary(report.resolvedBy),
  };
};

// ADMIN GET /reports?status&page&limit → { items, total, openCount }
const listReports = async ({ status, skip, limit }) => {
  const filter = status ? { status } : {};
  const [items, total, openCount] = await Promise.all([
    MarketReport.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate(REPORT_POPULATE).lean(),
    MarketReport.countDocuments(filter),
    MarketReport.countDocuments({ status: 'OPEN' }),
  ]);
  return { items: items.map(presentReport), total, openCount };
};

// ADMIN POST /reports/:id/resolve { note? }: outcome UNPUBLISHED when the document is unpublished now, else NO_ACTION.
const resolveReport = async (admin, reportId, note = null) => {
  const report = await MarketReport.findById(reportId).lean();
  if (!report) throw notFound('Report');
  if (report.status !== 'OPEN') throw invalidState('This report is already resolved', { status: report.status });
  const doc = await MarketDocument.findById(report.document).select('status').lean();
  const outcome = doc?.status === 'UNPUBLISHED' ? 'UNPUBLISHED' : 'NO_ACTION';
  const updated = await MarketReport.findOneAndUpdate(
    { _id: report._id, status: 'OPEN' },
    { $set: { status: 'RESOLVED', outcome, note, resolvedAt: new Date(), resolvedBy: admin._id } },
    { returnDocument: 'after' }
  )
    .populate(REPORT_POPULATE)
    .lean();
  if (!updated) throw invalidState('This report is already resolved', { status: 'RESOLVED' });
  return presentReport(updated);
};

module.exports = {
  STORAGE_FOLDER,
  canSee,
  canDownload,
  findVisibleDocument,
  presentDocuments,
  presentDocument,
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  prepareDownload,
  purchaseDocument,
  listReviews,
  saveReview,
  deleteOwnReview,
  deleteReview,
  reportDocument,
  approveDocument,
  rejectDocument,
  unpublishDocument,
  listReports,
  resolveReport,
  applyRating,
  excerpt,
};
