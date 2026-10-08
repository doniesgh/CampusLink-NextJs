const mongoose = require('mongoose');
const AlumniProfile = require('../models/alumniProfileModel');
const MentoringRequest = require('../models/mentoringRequestModel');
const AlumniPost = require('../models/alumniPostModel');
const Program = require('../models/programModel');
const User = require('../models/userModel');
const HttpError = require('../utils/httpError');
const { notFound, validationError, escapeRegex } = require('../utils/validation');
const { idOf, isPopulated } = require('../utils/serialize');
const { notifyUsersInBackground } = require('./notificationService');

/*
 * Business rules of Module 6 (alumni directory and network), phase 3 contract section 4: profiles and consent
 * (GDPR), directory, mentoring requests (limits, contact sharing, MENTORING notifications), news wall and
 * moderation, data export and erasure. HTTP parsing and audit entries live in controllers/alumniController.js.
 * Functions take the signed-in user (req.user).
 */

const { PROFILE_POPULATE, LISTED_FILTER, normalizeKey, isListed, serializeProfile } = AlumniProfile;
const { MAX_PENDING_PER_STUDENT, serializeRequest } = MentoringRequest;
const { serializePost } = AlumniPost;

const OPEN_STATUSES = ['PENDING', 'ACCEPTED'];
const NOTIFICATION_EXCERPT_LENGTH = 140;
const FACET_LIMIT = 50;
const SKILL_FACET_LIMIT = 30;
// Case-insensitive name sorting that ignores diacritics ("Émna" next to "Emna").
const NAME_COLLATION = { locale: 'fr', strength: 1 };

const forbidden = (message = 'You do not have permission to perform this action') =>
  new HttpError(403, 'FORBIDDEN', message);
const invalidState = (message, details) => new HttpError(409, 'INVALID_STATE', message, details);
const isDuplicateKey = (error) => error?.code === 11000;
const duplicateKeyFields = (error) => Object.keys(error?.keyPattern ?? error?.keyValue ?? {});

const isAdmin = (user) => user?.role === 'ADMIN';
const sameId = (a, b) => {
  const left = idOf(a);
  return left !== null && left === idOf(b);
};
const fullName = (person) => `${person?.firstname ?? ''} ${person?.lastname ?? ''}`.trim();

// Single line, at most `max` characters.
const excerpt = (text, max = NOTIFICATION_EXCERPT_LENGTH) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/**
 * Replaces the user ids found at `paths` of each lean document by { _id, firstname, lastname, role (, email) } when
 * the account exists. Ids of deleted accounts stay ids, so serializers fall back to the name snapshots (a Mongoose
 * populate would turn them into null and lose the id). E-mails are loaded only for the contact block of mentoring.
 */
const attachUsers = async (docs, paths, { withEmail = false } = {}) => {
  const ids = new Set();
  docs.forEach((doc) =>
    paths.forEach((path) => {
      const id = idOf(doc[path]);
      if (id) ids.add(id);
    })
  );
  if (ids.size === 0) return docs;
  const users = await User.find({ _id: { $in: [...ids] } })
    .select(withEmail ? 'firstname lastname role email' : 'firstname lastname role')
    .lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  docs.forEach((doc) =>
    paths.forEach((path) => {
      const user = byId.get(idOf(doc[path]) ?? '');
      if (user) doc[path] = user;
    })
  );
  return docs;
};

const withParties = (requests) => attachUsers(requests, ['mentor', 'mentee'], { withEmail: true });
const withAuthors = (posts) => attachUsers(posts, ['author']);

// ---------- Search helpers ----------

// Accented variants of the base letters, so "selim" matches "Sélim" and "securite" matches "Sécurité".
const FOLDED_LETTERS = {
  a: 'aàáâãäå',
  c: 'cç',
  e: 'eèéêë',
  i: 'iìíîï',
  n: 'nñ',
  o: 'oòóôõö',
  u: 'uùúûü',
  y: 'yýÿ',
};

// Case- and diacritic-insensitive "contains" regex of one search word.
const foldedRegex = (word) => {
  let pattern = '';
  for (const char of normalizeKey(word)) {
    const variants = FOLDED_LETTERS[char];
    pattern += variants ? `[${variants}${variants.toUpperCase()}]` : escapeRegex(char);
  }
  return new RegExp(pattern, 'i');
};

const SEARCH_FIELDS = ['u.firstname', 'u.lastname', 'headline', 'company', 'jobTitle', 'sector', 'city', 'skills', 'mentoringTopics'];
const MAX_SEARCH_WORDS = 6;

// Every word of `q` must appear in one of the searched fields.
const searchFilter = (q) => {
  const words = String(q ?? '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, MAX_SEARCH_WORDS);
  if (words.length === 0) return null;
  return {
    $and: words.map((word) => {
      const regex = foldedRegex(word);
      return { $or: SEARCH_FIELDS.map((field) => ({ [field]: regex })) };
    }),
  };
};

// $lookup of the owner (names and role only) into `u`, dropping profiles whose account no longer exists.
const ownerLookup = () => [
  {
    $lookup: {
      from: User.collection.name,
      let: { owner: '$user' },
      pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$owner'] } } }, { $project: { firstname: 1, lastname: 1, role: 1 } }],
      as: 'u',
    },
  },
  { $unwind: '$u' },
];

const SORTS = {
  name: { 'u.lastname': 1, 'u.firstname': 1, _id: 1 },
  recent: { updatedAt: -1, _id: -1 },
  promotion: { promotion: -1, 'u.lastname': 1, 'u.firstname': 1, _id: 1 },
};

// Directory filters on the profile fields (values already validated by the controller).
const profileFilters = ({ program, promotion, sector, skill, mentoring }) => {
  const filter = {};
  if (program) filter.program = program;
  if (promotion !== undefined) filter.promotion = promotion;
  if (sector) filter.sectorKey = normalizeKey(sector);
  if (skill) filter.skillKeys = normalizeKey(skill);
  if (mentoring !== undefined) filter.mentoringAvailable = mentoring;
  return filter;
};

// Runs a profile aggregation (owner in `u`) and returns { items: [AlumniProfile JSON], total }.
const pagedProfiles = async (match, ownerMatch, { sort = 'name', skip, limit, extra } = {}) => {
  const [result] = await AlumniProfile.aggregate([
    { $match: match },
    ...ownerLookup(),
    ...(ownerMatch && Object.keys(ownerMatch).length > 0 ? [{ $match: ownerMatch }] : []),
    { $sort: SORTS[sort] ?? SORTS.name },
    { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'count' }] } },
  ]).collation(NAME_COLLATION);
  const docs = result?.items ?? [];
  await AlumniProfile.populate(docs, { path: 'program', select: 'name code' });
  return {
    items: docs.map((doc) => ({ ...serializeProfile(doc, { user: doc.u }), ...(extra ? extra(doc) : {}) })),
    total: result?.total?.[0]?.count ?? 0,
  };
};

// ---------- Profiles ----------

// Other users see a profile only when it is listed (CAMPUS + consent) and its owner is an ALUMNI;
// the owner and ADMINs (support) always see it.
const canViewProfile = (viewer, profile) => {
  if (!profile) return false;
  if (sameId(profile.user, viewer)) return true;
  if (isAdmin(viewer)) return true;
  const owner = profile.user;
  return isListed(profile) && isPopulated(owner) && owner.role === 'ALUMNI';
};

// Profile by its id or by its owner's user id (both are accepted in the URL), owner and program populated.
const findProfile = async (id) => {
  const objectId = new mongoose.Types.ObjectId(String(id));
  const profile = await AlumniProfile.findOne({ $or: [{ _id: objectId }, { user: objectId }] })
    .populate(PROFILE_POPULATE)
    .lean();
  return profile && isPopulated(profile.user) ? profile : null;
};

// The profile shape of an account that has not saved a profile yet (`id: null`, PRIVATE).
const emptyProfile = (user) =>
  serializeProfile({ _id: null, user, visibility: 'PRIVATE', consentAt: null, updatedAt: null });

// GET /me → AlumniProfile (empty shape when none was saved; nothing is created by a read).
const getMyProfile = async (user) => {
  const profile = await AlumniProfile.findOne({ user: user._id }).populate(PROFILE_POPULATE).lean();
  return profile ? serializeProfile(profile) : emptyProfile(user);
};

// Applies the consent rules (contract section 4) to the profile document. Throws 400 VALIDATION_ERROR.
//  - CAMPUS needs an explicit consent: `consent: true` (now or earlier, consentAt kept while CAMPUS);
//  - `consent: false` withdraws it and makes the profile PRIVATE;
//  - a PRIVATE profile never keeps a consent (consentAt null).
const applyVisibility = (profile, { visibility, consent }, now) => {
  let consentAt = profile.consentAt ?? null;
  let next = visibility ?? profile.visibility ?? 'PRIVATE';
  if (consent === false) {
    if (visibility === 'CAMPUS') {
      throw validationError({ consent: 'consent must be true to make the profile visible to the campus' });
    }
    consentAt = null;
    next = 'PRIVATE';
  }
  if (consent === true && !consentAt) consentAt = now;
  if (next === 'CAMPUS' && !consentAt) {
    throw validationError({ consent: 'consent: true is required to make the profile visible to the campus' });
  }
  if (next === 'PRIVATE') consentAt = null;
  profile.visibility = next;
  profile.consentAt = consentAt;
};

/**
 * PUT /me: creates or updates the caller's profile. `values` holds only the fields sent (already validated):
 * program, promotion, headline, bio, skills, company, jobTitle, sector, city, linkedinUrl, mentoringAvailable,
 * mentoringTopics, visibility, consent.
 */
const updateMyProfile = async (user, values) => {
  const { visibility, consent, ...fields } = values;
  for (let attempt = 0; ; attempt += 1) {
    let profile = await AlumniProfile.findOne({ user: user._id });
    if (!profile) profile = new AlumniProfile({ user: user._id });
    profile.set(fields);
    applyVisibility(profile, { visibility, consent }, new Date());
    try {
      await profile.save();
      break;
    } catch (error) {
      // Two first saves at the same time: the unique `user` index lets one win, the other applies its changes again.
      if (isDuplicateKey(error) && attempt === 0) continue;
      throw error;
    }
  }
  return getMyProfile(user);
};

// Latest mentoring request of a student to this mentor (an open one first): { id, status } | null.
const myRequestTo = async (student, mentorId) => {
  if (student.role !== 'STUDENT') return null;
  const base = { mentee: student._id, mentor: mentorId };
  const request =
    (await MentoringRequest.findOne({ ...base, status: { $in: OPEN_STATUSES } }).sort({ createdAt: -1 }).select('status').lean()) ??
    (await MentoringRequest.findOne(base).sort({ createdAt: -1 }).select('status').lean());
  return request ? { id: String(request._id), status: request.status } : null;
};

// GET /:id → AlumniProfile + myRequest (404 when the viewer may not see it).
const getProfile = async (viewer, id) => {
  const profile = await findProfile(id);
  if (!canViewProfile(viewer, profile)) throw notFound('Alumni profile');
  return { ...serializeProfile(profile), myRequest: await myRequestTo(viewer, profile.user._id) };
};

// GET / → listed profiles of ALUMNI accounts, filtered and paginated.
const listDirectory = async (viewer, { q, sort, skip, limit, ...filters }) => {
  const ownerMatch = { 'u.role': 'ALUMNI', ...(searchFilter(q) ?? {}) };
  return pagedProfiles({ ...LISTED_FILTER, ...profileFilters(filters) }, ownerMatch, { sort, skip, limit });
};

// GET /facets → values present in the directory, for the filters of the clients.
const directoryFacets = async () => {
  const [result] = await AlumniProfile.aggregate([
    { $match: { ...LISTED_FILTER } },
    ...ownerLookup(),
    { $match: { 'u.role': 'ALUMNI' } },
    {
      $facet: {
        total: [{ $count: 'count' }],
        mentoring: [{ $match: { mentoringAvailable: true } }, { $count: 'count' }],
        programs: [{ $match: { program: { $ne: null } } }, { $group: { _id: '$program', count: { $sum: 1 } } }],
        promotions: [
          { $match: { promotion: { $ne: null } } },
          { $group: { _id: '$promotion', count: { $sum: 1 } } },
          { $sort: { _id: -1 } },
          { $limit: FACET_LIMIT },
        ],
        sectors: [
          { $match: { sectorKey: { $ne: null } } },
          { $sort: { updatedAt: -1 } },
          { $group: { _id: '$sectorKey', value: { $first: '$sector' }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: FACET_LIMIT },
        ],
        skills: [
          { $unwind: '$skills' },
          { $group: { _id: { $toLower: '$skills' }, value: { $first: '$skills' }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: SKILL_FACET_LIMIT },
        ],
      },
    },
  ]);
  const programIds = (result?.programs ?? []).map((row) => row._id);
  const programs = await Program.find({ _id: { $in: programIds } }).select('name code').lean();
  const counts = new Map((result?.programs ?? []).map((row) => [String(row._id), row.count]));
  return {
    total: result?.total?.[0]?.count ?? 0,
    mentoringAvailable: result?.mentoring?.[0]?.count ?? 0,
    programs: programs
      .map((program) => ({ id: String(program._id), name: program.name, code: program.code, count: counts.get(String(program._id)) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    promotions: (result?.promotions ?? []).map((row) => ({ value: row._id, count: row.count })),
    sectors: (result?.sectors ?? []).map((row) => ({ value: row.value, count: row.count })),
    skills: (result?.skills ?? []).map((row) => ({ value: row.value, count: row.count })),
  };
};

// ADMIN GET /admin/profiles → every profile (PRIVATE ones too), with `listed` (shown in the directory or not).
const adminListProfiles = async ({ q, visibility, mentoring, skip, limit }) => {
  const match = {};
  if (visibility) match.visibility = visibility;
  if (mentoring !== undefined) match.mentoringAvailable = mentoring;
  return pagedProfiles(match, searchFilter(q), {
    sort: 'recent',
    skip,
    limit,
    extra: (doc) => ({ listed: isListed(doc) && doc.u?.role === 'ALUMNI' }),
  });
};

// ---------- Mentoring ----------

const mentorLink = () => '/dashboard/alumni/me#mentoring';
const menteeLink = () => '/dashboard/alumni#mentoring';

const notifyMentoring = (recipientId, { kind, request, link, title, body }) => {
  if (!recipientId) return;
  notifyUsersInBackground([recipientId], (locale) => ({
    type: 'MENTORING',
    title: title[locale] ?? title.en,
    body: body[locale] ?? body.en,
    link,
    data: { kind, requestId: String(request._id) },
    tag: `mentoring-${request._id}`,
  }));
};

// Profile ids of the mentors that the viewer may open, by mentor user id.
const mentorProfileIds = async (viewer, requests) => {
  const mentorIds = [...new Set(requests.map((request) => idOf(request.mentor)).filter(Boolean))];
  if (mentorIds.length === 0) return new Map();
  const profiles = await AlumniProfile.find({ user: { $in: mentorIds } }).select('user visibility consentAt').lean();
  const byUser = new Map();
  profiles.forEach((profile) => {
    const request = requests.find((item) => sameId(item.mentor, profile.user));
    const owner = request?.mentor;
    const visible =
      sameId(profile.user, viewer) ||
      isAdmin(viewer) ||
      (isListed(profile) && isPopulated(owner) && owner.role === 'ALUMNI');
    if (visible) byUser.set(String(profile.user), String(profile._id));
  });
  return byUser;
};

const isParticipant = (user, request) => sameId(request.mentor, user) || sameId(request.mentee, user);

// Request JSON for the viewer: contact only for participants (and only while ACCEPTED).
const serializeForViewer = async (viewer, requests) => {
  const profileIds = await mentorProfileIds(viewer, requests);
  return requests.map((request) =>
    serializeRequest(request, {
      withContact: isParticipant(viewer, request),
      mentorProfileId: profileIds.get(idOf(request.mentor) ?? '') ?? null,
    })
  );
};

const loadRequest = async (id) => {
  const request = await MentoringRequest.findById(id).lean();
  return request ? (await withParties([request]))[0] : null;
};

/**
 * POST /:id/mentoring (STUDENT) { topic, message } → 201 MentoringRequest.
 * The alumni profile must be visible (404) with mentoringAvailable (409 MENTORING_UNAVAILABLE); one PENDING request
 * per pair (409 ALREADY_REQUESTED); at most 3 PENDING requests per student (409 MENTORING_LIMIT_REACHED).
 */
const createMentoringRequest = async (student, profileId, { topic, message }) => {
  const profile = await findProfile(profileId);
  if (!profile || !canViewProfile(student, profile) || sameId(profile.user, student)) throw notFound('Alumni profile');
  if (!profile.mentoringAvailable) {
    throw new HttpError(409, 'MENTORING_UNAVAILABLE', 'This alumni does not accept mentoring requests at the moment');
  }
  const mentor = profile.user;

  const alreadyRequested = () =>
    new HttpError(409, 'ALREADY_REQUESTED', 'You already have a pending request with this alumni');
  const limitReached = (current) =>
    new HttpError(409, 'MENTORING_LIMIT_REACHED', `You can have at most ${MAX_PENDING_PER_STUDENT} pending mentoring requests`, {
      limit: MAX_PENDING_PER_STUDENT,
      current,
    });

  const pending = await MentoringRequest.find({ mentee: student._id, status: 'PENDING' }).select('mentor pendingSlot').lean();
  if (pending.some((request) => sameId(request.mentor, mentor))) throw alreadyRequested();
  if (pending.length >= MAX_PENDING_PER_STUDENT) throw limitReached(pending.length);

  // Claim a free pending slot: the unique (mentee, pendingSlot) index among PENDING requests makes the limit hold
  // under concurrency, the unique (mentee, mentor) one the "one pending request per pair" rule.
  const taken = new Set(pending.map((request) => request.pendingSlot));
  const slots = [];
  for (let slot = 1; slot <= MAX_PENDING_PER_STUDENT; slot += 1) if (!taken.has(slot)) slots.push(slot);
  for (let slot = 1; slot <= MAX_PENDING_PER_STUDENT; slot += 1) if (taken.has(slot)) slots.push(slot);

  let created = null;
  for (const slot of slots) {
    try {
      created = await MentoringRequest.create({
        mentor: mentor._id,
        mentee: student._id,
        mentorSnapshot: { firstname: mentor.firstname, lastname: mentor.lastname },
        menteeSnapshot: { firstname: student.firstname, lastname: student.lastname },
        topic,
        message,
        status: 'PENDING',
        pendingSlot: slot,
      });
      break;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const fields = duplicateKeyFields(error);
      if (fields.includes('mentor')) throw alreadyRequested();
      if (!fields.includes('pendingSlot')) throw error;
    }
  }
  if (!created) throw limitReached(MAX_PENDING_PER_STUDENT);

  // The mentor may have erased their data meanwhile (profile deleted first, then requests anonymized): never leave
  // a request to an erased mentor behind.
  if (!(await AlumniProfile.exists({ user: mentor._id }))) {
    await MentoringRequest.deleteOne({ _id: created._id });
    throw notFound('Alumni profile');
  }

  const menteeName = fullName(student);
  notifyMentoring(mentor._id, {
    kind: 'REQUEST',
    request: created,
    link: mentorLink(),
    title: { fr: `Nouvelle demande de mentorat de ${menteeName}`, en: `New mentoring request from ${menteeName}` },
    body: { fr: `Sujet : ${excerpt(topic)}`, en: `Topic: ${excerpt(topic)}` },
  });

  const [json] = await serializeForViewer(student, [await loadRequest(created._id)]);
  return json;
};

/**
 * GET /mentoring?role=mentor|mentee&status&page&limit → { items, total, page, limit, pendingCount }.
 * Default role: mentor for ALUMNI, mentee for everyone else. `statuses` = list of statuses (empty = all).
 */
const listMentoring = async (user, { role, statuses, skip, limit }) => {
  const side = role ?? (user.role === 'ALUMNI' ? 'mentor' : 'mentee');
  const base = { [side]: user._id };
  const filter = statuses?.length ? { ...base, status: { $in: statuses } } : base;
  const [docs, total, pendingCount] = await Promise.all([
    MentoringRequest.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean().then(withParties),
    MentoringRequest.countDocuments(filter),
    MentoringRequest.countDocuments({ ...base, status: 'PENDING' }),
  ]);
  return { role: side, items: await serializeForViewer(user, docs), total, pendingCount };
};

// GET /mentoring/:id → participants and ADMINs (contact for participants only), others 404.
const getMentoringRequest = async (user, id) => {
  const request = await loadRequest(id);
  if (!request || (!isParticipant(user, request) && !isAdmin(user))) throw notFound('Mentoring request');
  const [json] = await serializeForViewer(user, [request]);
  return json;
};

// Explains why a compare-and-set on a request failed: 404 (not visible), 403 (not allowed) or 409 (state).
const explainRequestFailure = async (user, id, { mentorOnly }) => {
  const request = await MentoringRequest.findById(id).lean();
  if (!request || (!isParticipant(user, request) && !isAdmin(user))) throw notFound('Mentoring request');
  if (mentorOnly ? !sameId(request.mentor, user) : !isParticipant(user, request)) throw forbidden();
  throw invalidState(`This mentoring request is ${request.status.toLowerCase()}`, { status: request.status });
};

/**
 * POST /mentoring/:id/accept | decline (mentor) { reply? } → 200 MentoringRequest.
 * Atomic compare-and-set on PENDING: concurrent answers → exactly one wins, the others get 409 INVALID_STATE.
 */
const respondToRequest = async (user, id, decision, reply) => {
  const status = decision === 'accept' ? 'ACCEPTED' : 'DECLINED';
  const updated = await MentoringRequest.findOneAndUpdate(
    { _id: id, mentor: user._id, status: 'PENDING' },
    { $set: { status, reply: reply ?? null, respondedAt: new Date(), pendingSlot: null } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) await explainRequestFailure(user, id, { mentorOnly: true });

  const mentorName = fullName(user);
  const answer = reply ? excerpt(reply) : null;
  const topic = excerpt(updated.topic);
  if (status === 'ACCEPTED') {
    notifyMentoring(updated.mentee, {
      kind: 'ACCEPTED',
      request: updated,
      link: menteeLink(),
      title: {
        fr: `${mentorName} a accepté ta demande de mentorat`,
        en: `${mentorName} accepted your mentoring request`,
      },
      body: {
        fr: answer ? `« ${answer} »` : `Sujet : ${topic}. Tu trouveras son adresse e-mail dans ta demande.`,
        en: answer ? `"${answer}"` : `Topic: ${topic}. You'll find their email address in your request.`,
      },
    });
  } else {
    notifyMentoring(updated.mentee, {
      kind: 'DECLINED',
      request: updated,
      link: menteeLink(),
      title: {
        fr: `${mentorName} ne peut pas accepter ta demande de mentorat`,
        en: `${mentorName} declined your mentoring request`,
      },
      body: {
        fr: answer ? `« ${answer} »` : `Sujet : ${topic}. N'hésite pas à contacter un·e autre alumni.`,
        en: answer ? `"${answer}"` : `Topic: ${topic}. Feel free to reach out to another graduate.`,
      },
    });
  }

  const [json] = await serializeForViewer(user, [await loadRequest(updated._id)]);
  return json;
};

/**
 * POST /mentoring/:id/close (mentor or mentee) → 200 MentoringRequest CLOSED. PENDING (withdraw) or ACCEPTED (end of
 * the mentoring); the other side is notified. Already DECLINED / CLOSED → 409 INVALID_STATE.
 */
const closeRequest = async (user, id) => {
  const existing = await MentoringRequest.findById(id).lean();
  if (!existing || (!isParticipant(user, existing) && !isAdmin(user))) throw notFound('Mentoring request');
  if (!isParticipant(user, existing)) throw forbidden();
  const side = sameId(existing.mentor, user) ? 'mentor' : 'mentee';

  const updated = await MentoringRequest.findOneAndUpdate(
    { _id: id, [side]: user._id, status: { $in: OPEN_STATUSES } },
    { $set: { status: 'CLOSED', closedAt: new Date(), closedBy: side === 'mentor' ? 'MENTOR' : 'MENTEE', pendingSlot: null } },
    { returnDocument: 'after' }
  ).lean();
  if (!updated) await explainRequestFailure(user, id, { mentorOnly: false });

  const name = fullName(user);
  const topic = excerpt(updated.topic);
  notifyMentoring(side === 'mentor' ? updated.mentee : updated.mentor, {
    kind: 'CLOSED',
    request: updated,
    link: side === 'mentor' ? menteeLink() : mentorLink(),
    title: { fr: `${name} a clôturé la demande de mentorat`, en: `${name} closed the mentoring request` },
    body: { fr: `Sujet : ${topic}`, en: `Topic: ${topic}` },
  });

  const [json] = await serializeForViewer(user, [await loadRequest(updated._id)]);
  return json;
};

// ---------- News wall ----------

const canSeePost = (user, post) => !post.hidden || isAdmin(user) || sameId(post.author, user);

// Posts JSON with the author's profile link when the viewer may open that profile.
const serializePosts = async (viewer, posts) => {
  const authorIds = [...new Set(posts.map((post) => idOf(post.author)).filter(Boolean))];
  const profiles = authorIds.length
    ? await AlumniProfile.find({ user: { $in: authorIds } }).select('user visibility consentAt headline').lean()
    : [];
  const byUser = new Map(profiles.map((profile) => [String(profile.user), profile]));
  return posts.map((post) => {
    const profile = byUser.get(idOf(post.author) ?? '');
    const author = post.author;
    const visible =
      profile &&
      (sameId(post.author, viewer) || isAdmin(viewer) || (isListed(profile) && isPopulated(author) && author.role === 'ALUMNI'));
    return serializePost(post, { authorProfile: visible ? profile : null });
  });
};

/**
 * GET /posts?type&author&hidden&page&limit → { items, total }. Newest first. Hidden posts only for ADMINs and their
 * author; `hidden` (true | false) filters for ADMINs only. `author` = user id.
 */
const listPosts = async (viewer, { type, author, hidden, skip, limit }) => {
  const filter = {};
  if (type) filter.type = type;
  if (author) filter.author = author;
  if (isAdmin(viewer)) {
    if (hidden !== undefined) filter.hidden = hidden;
  } else {
    filter.$or = [{ hidden: false }, { author: viewer._id }];
  }
  const [docs, total] = await Promise.all([
    AlumniPost.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean().then(withAuthors),
    AlumniPost.countDocuments(filter),
  ]);
  return { items: await serializePosts(viewer, docs), total };
};

// POST /posts (ALUMNI) { type, body, link? } → 201 AlumniPost.
const createPost = async (user, { type, body, link }) => {
  const post = await AlumniPost.create({
    author: user._id,
    authorSnapshot: { firstname: user.firstname, lastname: user.lastname },
    type,
    body,
    link: link ?? null,
  });
  const [doc] = await withAuthors([post.toObject()]);
  const [json] = await serializePosts(user, [doc]);
  return json;
};

/**
 * DELETE /posts/:id (author or ADMIN) → { post, byAdmin } (the deleted document). Invisible → 404; visible but not
 * allowed → 403. Concurrent deletions: only one succeeds (the other gets 404).
 */
const deletePost = async (user, id) => {
  const post = await AlumniPost.findById(id).lean();
  if (!post || !canSeePost(user, post)) throw notFound('Post');
  const isAuthor = sameId(post.author, user);
  if (!isAuthor && !isAdmin(user)) throw forbidden();
  const deleted = await AlumniPost.findOneAndDelete({ _id: id }).lean();
  if (!deleted) throw notFound('Post');
  return { post: deleted, byAdmin: isAdmin(user) && !isAuthor };
};

/**
 * ADMIN POST /posts/:id/hide { reason? } | unhide → { post (JSON), doc, changed }. Idempotent: `changed` is false when
 * the post was already in that state (no second audit entry).
 */
const setPostHidden = async (admin, id, hidden, reason) => {
  const update = hidden
    ? { $set: { hidden: true, hiddenAt: new Date(), hiddenBy: admin._id, hiddenReason: reason ?? null } }
    : { $set: { hidden: false, hiddenAt: null, hiddenBy: null, hiddenReason: null } };
  let doc = await AlumniPost.findOneAndUpdate({ _id: id, hidden: !hidden }, update, { returnDocument: 'after' }).lean();
  const changed = Boolean(doc);
  if (!doc) {
    doc = await AlumniPost.findById(id).lean();
    if (!doc) throw notFound('Post');
  }
  await withAuthors([doc]);
  const [post] = await serializePosts(admin, [doc]);
  return { post, doc, changed };
};

// ---------- GDPR: export and erasure ----------

/**
 * GET /me/export → everything stored about the caller by this module: account summary, profile, posts (hidden ones
 * too), mentoring requests as mentor and as mentee (with the contact e-mails of the accepted ones, as in the app).
 */
const exportMyData = async (user) => {
  const profile = await AlumniProfile.findOne({ user: user._id }).populate(PROFILE_POPULATE).lean();
  const [posts, asMentor, asMentee] = await Promise.all([
    AlumniPost.find({ author: user._id }).sort({ createdAt: -1 }).lean().then(withAuthors),
    MentoringRequest.find({ mentor: user._id }).sort({ createdAt: -1 }).lean().then(withParties),
    MentoringRequest.find({ mentee: user._id }).sort({ createdAt: -1 }).lean().then(withParties),
  ]);
  const data = {
    exportedAt: new Date().toISOString(),
    user: {
      id: String(user._id),
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      role: user.role,
      locale: user.locale,
      createdAt: user.createdAt,
    },
    profile: profile ? { ...serializeProfile(profile), createdAt: profile.createdAt } : null,
    // Hidden posts too, with the reason given by the moderation team.
    posts: posts.map((post) => serializePost(post, { authorProfile: profile })),
    mentoring: {
      asMentor: await serializeForViewer(user, asMentor),
      asMentee: await serializeForViewer(user, asMentee),
    },
  };
  return {
    data,
    counts: { profile: Boolean(profile), posts: posts.length, asMentor: asMentor.length, asMentee: asMentee.length },
  };
};

// Pipeline update that closes an open request (SYSTEM) and anonymizes one side of it, in one atomic write per document.
const anonymizeSide = (side, now) => {
  const isOpen = { $in: ['$status', OPEN_STATUSES] };
  const set = {
    status: { $cond: [isOpen, 'CLOSED', '$status'] },
    closedAt: { $cond: [isOpen, now, '$closedAt'] },
    closedBy: { $cond: [isOpen, 'SYSTEM', '$closedBy'] },
    pendingSlot: null,
  };
  if (side === 'mentor') {
    Object.assign(set, { mentor: null, mentorSnapshot: { firstname: '', lastname: '' }, reply: null, mentorErasedAt: now });
  } else {
    Object.assign(set, { mentee: null, menteeSnapshot: { firstname: '', lastname: '' }, message: null, menteeErasedAt: now });
  }
  return [{ $set: set }];
};

/**
 * Right to be forgotten for one account: deletes the alumni profile and posts, closes the open mentoring requests and
 * anonymizes the mentoring history on both sides (names, reply / message removed), deletes the account's own MENTORING
 * notifications, and tells the other participants of the requests that were still open. Used by DELETE /me (audited
 * by the controller) and available to the account deletion (purgeUser).
 * → { profileId, profile, posts, mentoringAsMentor, mentoringAsMentee }
 */
const eraseUserData = async (userId) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const now = new Date();

  // Profile first: a mentoring request created meanwhile sees it gone and removes itself (createMentoringRequest).
  const profile = await AlumniProfile.findOneAndDelete({ user: id }).lean();
  const { deletedCount: posts } = await AlumniPost.deleteMany({ author: id });

  const open = await MentoringRequest.find({
    $or: [{ mentor: id }, { mentee: id }],
    status: { $in: OPEN_STATUSES },
  })
    .select('mentor mentee topic')
    .lean();
  const pipeline = { updatePipeline: true };
  const asMentor = await MentoringRequest.updateMany({ mentor: id }, anonymizeSide('mentor', now), pipeline);
  const asMentee = await MentoringRequest.updateMany({ mentee: id }, anonymizeSide('mentee', now), pipeline);
  await mongoose.models.Notification?.deleteMany({ user: id, type: 'MENTORING' });

  open.forEach((request) => {
    const other = sameId(request.mentor, id) ? request.mentee : request.mentor;
    const link = sameId(request.mentor, id) ? menteeLink() : mentorLink();
    const topic = excerpt(request.topic);
    notifyMentoring(other, {
      kind: 'ERASED',
      request,
      link,
      title: { fr: 'Demande de mentorat clôturée', en: 'Mentoring request closed' },
      body: {
        fr: `Sujet : ${topic}. L'autre personne a supprimé ses données du réseau alumni.`,
        en: `Topic: ${topic}. The other person deleted their alumni network data.`,
      },
    });
  });

  return {
    profileId: profile ? String(profile._id) : null,
    profile: Boolean(profile),
    posts,
    mentoringAsMentor: asMentor.modifiedCount,
    mentoringAsMentee: asMentee.modifiedCount,
  };
};

// For the account deletion (DELETE /api/users/:id): same as an erasure, never throws.
const purgeUser = async (userId) => {
  try {
    return await eraseUserData(userId);
  } catch (error) {
    console.error(`[alumni] Could not purge the alumni data of ${userId}:`, error.message);
    return null;
  }
};

module.exports = {
  OPEN_STATUSES,
  SORTS: Object.keys(SORTS),
  excerpt,
  foldedRegex,
  canViewProfile,
  getMyProfile,
  updateMyProfile,
  getProfile,
  listDirectory,
  directoryFacets,
  adminListProfiles,
  createMentoringRequest,
  listMentoring,
  getMentoringRequest,
  respondToRequest,
  closeRequest,
  listPosts,
  createPost,
  deletePost,
  setPostHidden,
  exportMyData,
  eraseUserData,
  purgeUser,
};
