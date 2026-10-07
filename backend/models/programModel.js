const mongoose = require('mongoose');
const { refSummary } = require('../utils/serialize');

const Schema = mongoose.Schema;

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;

// A study program (e.g. "TWIN", "DS"). Groups belong to a program.
const programSchema = new Schema(
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
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description must be at most 1000 characters'],
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: {
      // { id, name, code, description }
      transform: (doc, ret) => ({
        id: String(ret._id),
        name: ret.name,
        code: ret.code,
        description: ret.description || '',
      }),
    },
  }
);

const Program = mongoose.model('Program', programSchema);

// { id, name, code } of a populated program ({ id } when not populated), or null.
const summarizeProgram = (program) => refSummary(program, ['name', 'code']);

module.exports = Program;
module.exports.summarizeProgram = summarizeProgram;
module.exports.CODE_PATTERN = CODE_PATTERN;
