const mongoose = require('mongoose');
const { CODE_PATTERN } = require('./programModel');

const Schema = mongoose.Schema;

const COLOR_PATTERN = /^#[0-9A-F]{6}$/;

// Default colors, assigned in turn to new subjects without a color. Mid-tone hues that keep
// white text readable (WCAG AA for large/bold text) and stay distinct in the timetable.
const SUBJECT_COLORS = [
  '#253C6D', // charter indigo
  '#1F7A8C',
  '#2E7D32',
  '#B4531A',
  '#8E24AA',
  '#C62828',
  '#00695C',
  '#5D4037',
  '#3949AB',
  '#AD1457',
  '#546E7A',
  '#6D4C41',
];

const pickSubjectColor = (index) => SUBJECT_COLORS[Math.abs(Number(index) || 0) % SUBJECT_COLORS.length];

const subjectSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [120, 'Name must be at most 120 characters'],
    },
    // Stored uppercase, unique.
    code: {
      type: String,
      required: [true, 'Code is required'],
      trim: true,
      uppercase: true,
      unique: true,
      match: [CODE_PATTERN, 'Code must be 1 to 20 letters, digits, "-" or "_"'],
    },
    // "#RRGGBB", stored uppercase.
    color: {
      type: String,
      required: [true, 'Color is required'],
      trim: true,
      uppercase: true,
      match: [COLOR_PATTERN, 'Color must look like "#253C6D"'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      // { id, name, code, color }
      transform: (doc, ret) => ({ id: String(ret._id), name: ret.name, code: ret.code, color: ret.color }),
    },
  }
);

const Subject = mongoose.model('Subject', subjectSchema);

module.exports = Subject;
module.exports.SUBJECT_COLORS = SUBJECT_COLORS;
module.exports.pickSubjectColor = pickSubjectColor;
module.exports.COLOR_PATTERN = COLOR_PATTERN;
