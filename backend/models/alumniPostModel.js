const mongoose = require('mongoose');
const { idOf, isPopulated } = require('../utils/serialize');

const Schema = mongoose.Schema;

// Module 6 (alumni network), phase 3 contract section 4: a post of the alumni news wall (plain text, never HTML).
const TYPES = ['NEW_JOB', 'ACHIEVEMENT', 'OPPORTUNITY', 'EVENT', 'OTHER'];
const BODY_MIN_LENGTH = 10;
const BODY_MAX_LENGTH = 2000;
const LINK_MAX_LENGTH = 500;
const HIDDEN_REASON_MAX_LENGTH = 500;

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Author's names when posting, used when the account no longer exists.
    authorSnapshot: {
      type: new Schema({ firstname: { type: String, default: '' }, lastname: { type: String, default: '' } }, { _id: false }),
      default: () => ({}),
    },
    type: { type: String, enum: TYPES, required: true },
    body: { type: String, required: true, minlength: BODY_MIN_LENGTH, maxlength: BODY_MAX_LENGTH },
    // Optional https:// URL (checked by the controller).
    link: { type: String, trim: true, maxlength: LINK_MAX_LENGTH, default: null },
    // Moderation: hidden posts are visible only to ADMINs and their author.
    hidden: { type: Boolean, default: false },
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    hiddenReason: { type: String, trim: true, maxlength: HIDDEN_REASON_MAX_LENGTH, default: null },
  },
  {
    timestamps: true,
    minimize: false,
    toJSON: {
      transform: (doc) => serializePost(doc),
    },
  }
);

postSchema.index({ hidden: 1, createdAt: -1 });
postSchema.index({ type: 1, createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });

const POST_POPULATE = [{ path: 'author', select: 'firstname lastname role' }];

/**
 * AlumniPost JSON:
 * { id, type, body, link, author: { id, firstname, lastname, profileId, headline } | null, hidden, hiddenAt,
 *   hiddenReason, createdAt, updatedAt }
 * `authorProfile` = the author's alumni profile when the viewer may open it ({ _id, headline }), else null.
 */
function serializePost(doc, { authorProfile = null } = {}) {
  const authorId = idOf(doc.author);
  let author = null;
  if (authorId) {
    const source = isPopulated(doc.author) ? doc.author : doc.authorSnapshot ?? {};
    author = {
      id: authorId,
      firstname: source.firstname ?? '',
      lastname: source.lastname ?? '',
      profileId: authorProfile ? String(authorProfile._id) : null,
      headline: authorProfile ? authorProfile.headline ?? null : null,
    };
  }
  const hidden = Boolean(doc.hidden);
  return {
    id: String(doc._id),
    type: doc.type,
    body: doc.body,
    link: doc.link ?? null,
    author,
    hidden,
    hiddenAt: hidden ? doc.hiddenAt ?? null : null,
    hiddenReason: hidden ? doc.hiddenReason ?? null : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? doc.createdAt,
  };
}

const AlumniPost = mongoose.model('AlumniPost', postSchema);

module.exports = AlumniPost;
module.exports.TYPES = TYPES;
module.exports.BODY_MIN_LENGTH = BODY_MIN_LENGTH;
module.exports.BODY_MAX_LENGTH = BODY_MAX_LENGTH;
module.exports.LINK_MAX_LENGTH = LINK_MAX_LENGTH;
module.exports.HIDDEN_REASON_MAX_LENGTH = HIDDEN_REASON_MAX_LENGTH;
module.exports.POST_POPULATE = POST_POPULATE;
module.exports.serializePost = serializePost;
