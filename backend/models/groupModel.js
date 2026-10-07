const mongoose = require('mongoose');
const { summarizeProgram } = require('./programModel');
const { idOf, isPopulated } = require('../utils/serialize');

const Schema = mongoose.Schema;

const MIN_LEVEL = 1;
const MAX_LEVEL = 5;
const ACADEMIC_YEAR_PATTERN = /^(\d{4})-(\d{4})$/;
// Names are unique per academic year, ignoring case ("4twin1" = "4TWIN1").
const NAME_COLLATION = { locale: 'en', strength: 2 };

const isAcademicYear = (value) => {
  const match = ACADEMIC_YEAR_PATTERN.exec(String(value));
  return Boolean(match) && Number(match[2]) === Number(match[1]) + 1;
};

// A class group (e.g. "4TWIN1") of a program, for one academic year. Students have one group.
const groupSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [50, 'Name must be at most 50 characters'],
    },
    level: {
      type: Number,
      required: [true, 'Level is required'],
      min: [MIN_LEVEL, `Level must be an integer between ${MIN_LEVEL} and ${MAX_LEVEL}`],
      max: [MAX_LEVEL, `Level must be an integer between ${MIN_LEVEL} and ${MAX_LEVEL}`],
      validate: {
        validator: Number.isInteger,
        message: `Level must be an integer between ${MIN_LEVEL} and ${MAX_LEVEL}`,
      },
    },
    academicYear: {
      type: String,
      required: [true, 'Academic year is required'],
      trim: true,
      validate: { validator: isAcademicYear, message: 'Academic year must look like "2026-2027"' },
    },
    program: {
      type: Schema.Types.ObjectId,
      ref: 'Program',
      required: [true, 'Program is required'],
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      // { id, name, level, academicYear, program: { id, name, code } }
      // (the academic API adds studentCount).
      transform: (doc, ret) => ({
        id: String(ret._id),
        name: ret.name,
        level: ret.level,
        academicYear: ret.academicYear,
        program: summarizeProgram(doc.program),
      }),
    },
  }
);

groupSchema.index({ academicYear: 1, name: 1 }, { unique: true, collation: NAME_COLLATION });
groupSchema.index({ level: 1 });

const Group = mongoose.model('Group', groupSchema);

// { id, name, level, academicYear, program: { id, name, code } } of a populated group,
// { id } when it is not populated, or null.
const summarizeGroup = (group) => {
  const id = idOf(group);
  if (!id) return null;
  if (!isPopulated(group)) return { id };
  return {
    id,
    name: group.name,
    level: group.level,
    academicYear: group.academicYear,
    program: summarizeProgram(group.program),
  };
};

module.exports = Group;
module.exports.summarizeGroup = summarizeGroup;
module.exports.isAcademicYear = isAcademicYear;
module.exports.MIN_LEVEL = MIN_LEVEL;
module.exports.MAX_LEVEL = MAX_LEVEL;
module.exports.NAME_COLLATION = NAME_COLLATION;
