const mongoose = require('mongoose');
const User = require('../models/userModel');
const Group = require('../models/groupModel');
const Program = require('../models/programModel');
const { idOf, isPopulated } = require('../utils/serialize');
const { readObjectIdList, readInteger, throwIfInvalid } = require('../utils/validation');

const { ROLES } = User;

/*
 * Audience of an announcement (contract section 7):
 *   { roles: [Role], programs: [programId], levels: [int], groups: [groupId] }
 * A user receives it when
 *   (roles empty OR role ∈ roles) AND (programs empty OR group.program ∈ programs)
 *   AND (levels empty OR group.level ∈ levels) AND (groups empty OR group ∈ groups).
 * Empty audience = everyone. Program/level/group criteria only match users that have a group.
 * Arrays may hold ids, id strings or populated documents.
 */

const idSet = (list) => new Set((list || []).map((item) => idOf(item)).filter(Boolean));
const hasItems = (list) => Array.isArray(list) && list.length > 0;
const hasGroupCriteria = (audience) =>
  hasItems(audience?.programs) || hasItems(audience?.levels) || hasItems(audience?.groups);

/**
 * True when `user` belongs to `audience`. Synchronous: `user.group` must be populated
 * (it is for req.user and every User query, see models/userModel.js) when the audience has
 * program or level criteria; with only an unpopulated group id, those criteria do not match.
 */
const userMatchesAudience = (user, audience = {}) => {
  if (!user) return false;
  const { roles = [], programs = [], levels = [], groups = [] } = audience || {};

  if (hasItems(roles) && !roles.includes(user.role)) return false;
  if (!hasGroupCriteria(audience)) return true;

  const group = user.group;
  const groupId = idOf(group);
  if (!groupId) return false;

  if (hasItems(groups) && !idSet(groups).has(groupId)) return false;

  if (hasItems(programs) || hasItems(levels)) {
    if (!isPopulated(group)) return false;
    if (hasItems(programs) && !idSet(programs).has(idOf(group.program))) return false;
    if (hasItems(levels) && !levels.map(Number).includes(Number(group.level))) return false;
  }
  return true;
};

// MongoDB filter on users matching the audience, or null when nobody can match.
const buildAudienceFilter = async (audience = {}) => {
  const { roles = [], programs = [], levels = [], groups = [] } = audience || {};
  const filter = {};

  if (hasItems(roles)) filter.role = { $in: roles };

  if (hasGroupCriteria(audience)) {
    const groupFilter = {};
    if (hasItems(groups)) groupFilter._id = { $in: [...idSet(groups)].map((id) => new mongoose.Types.ObjectId(id)) };
    if (hasItems(programs)) {
      groupFilter.program = { $in: [...idSet(programs)].map((id) => new mongoose.Types.ObjectId(id)) };
    }
    if (hasItems(levels)) groupFilter.level = { $in: levels.map(Number) };
    const groupIds = await Group.distinct('_id', groupFilter);
    if (groupIds.length === 0) return null;
    filter.group = { $in: groupIds };
  }

  return filter;
};

// Ids (ObjectId[]) of every user matching the audience.
const resolveAudienceUserIds = async (audience = {}) => {
  const filter = await buildAudienceFilter(audience);
  if (!filter) return [];
  return User.distinct('_id', filter);
};

// Number of users matching the audience (e.g. for an audience preview).
const countAudience = async (audience = {}) => {
  const filter = await buildAudienceFilter(audience);
  if (!filter) return 0;
  return User.countDocuments(filter);
};

/**
 * Validates an audience from a request body. Throws 400 VALIDATION_ERROR with
 * details['audience.roles' | 'audience.programs' | 'audience.levels' | 'audience.groups'],
 * including for unknown program / group ids.
 * @returns {Promise<{ roles: string[], programs: ObjectId[], levels: number[], groups: ObjectId[] }>}
 */
const parseAudience = async (input) => {
  const details = {};
  if (input === undefined || input === null) return { roles: [], programs: [], levels: [], groups: [] };
  if (typeof input !== 'object' || Array.isArray(input)) {
    throwIfInvalid({ audience: 'audience must be an object' });
  }

  const audience = { roles: [], programs: [], levels: [], groups: [] };

  if (input.roles !== undefined && input.roles !== null) {
    if (!Array.isArray(input.roles) || input.roles.some((role) => typeof role !== 'string')) {
      details['audience.roles'] = `audience.roles must be an array of ${ROLES.join(', ')}`;
    } else {
      const roles = [...new Set(input.roles.map((role) => role.trim().toUpperCase()))];
      if (roles.some((role) => !ROLES.includes(role))) {
        details['audience.roles'] = `audience.roles must be an array of ${ROLES.join(', ')}`;
      } else {
        audience.roles = roles;
      }
    }
  }

  if (input.levels !== undefined && input.levels !== null) {
    if (!Array.isArray(input.levels)) {
      details['audience.levels'] = 'audience.levels must be an array of integers between 1 and 5';
    } else {
      const levels = [];
      for (const level of input.levels) {
        const value = readInteger(level, 'audience.levels', details, { min: Group.MIN_LEVEL, max: Group.MAX_LEVEL });
        if (value === undefined) break;
        if (!levels.includes(value)) levels.push(value);
      }
      if (!details['audience.levels']) audience.levels = levels.sort((a, b) => a - b);
    }
  }

  if (input.programs !== undefined && input.programs !== null) {
    const ids = readObjectIdList(input.programs, 'audience.programs', details);
    if (ids) {
      if ((await Program.countDocuments({ _id: { $in: ids } })) !== ids.length) {
        details['audience.programs'] = 'audience.programs contains an unknown program';
      } else {
        audience.programs = ids;
      }
    }
  }

  if (input.groups !== undefined && input.groups !== null) {
    const ids = readObjectIdList(input.groups, 'audience.groups', details);
    if (ids) {
      if ((await Group.countDocuments({ _id: { $in: ids } })) !== ids.length) {
        details['audience.groups'] = 'audience.groups contains an unknown group';
      } else {
        audience.groups = ids;
      }
    }
  }

  throwIfInvalid(details);
  return audience;
};

module.exports = {
  userMatchesAudience,
  buildAudienceFilter,
  resolveAudienceUserIds,
  countAudience,
  parseAudience,
};
