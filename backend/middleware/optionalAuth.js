const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

const optionalAuth = async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization) {
    return next();
  }

  const parts = authorization.split(' ');
  const token = parts.length === 2 ? parts[1] : null;
  if (!token) {
    return next();
  }

  try {
    const { _id } = jwt.verify(token, process.env.SECRET);
    req.user = await User.findOne({ _id }).select('_id role firstname lastname email');
  } catch (error) {
    // Auth is optional: ignore invalid tokens and continue.
  }

  return next();
};

module.exports = optionalAuth;
