// Creates an ADMIN account, or promotes an existing account to ADMIN and sets its password.
// Usage (in backend/): npm run create-admin -- <email> <password> [firstname] [lastname]
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const mongoose = require('mongoose');
const User = require('../models/userModel');
const { revokeAllRefreshTokens } = require('../service/tokenService');

const usage = 'Usage: npm run create-admin -- <email> <password> [firstname] [lastname]';

const formatError = (error) => {
  if (error instanceof mongoose.Error.ValidationError) {
    return Object.values(error.errors)
      .map((item) => item.message)
      .join('; ');
  }
  return error.message;
};

const main = async () => {
  const [email, password, firstname = 'Admin', lastname = 'CampusLink'] = process.argv.slice(2);

  if (!email || !password) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Add it to backend/.env (see backend/.env.example).');
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  } catch (error) {
    console.error(`Could not connect to MongoDB (check MONGO_URI): ${error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    await User.init();
    const existing = await User.findOne({ email: email.trim().toLowerCase() });

    if (existing) {
      existing.role = 'ADMIN';
      existing.password = password;
      await existing.save();
      // The password changed: sign out every existing session of this account.
      await revokeAllRefreshTokens(existing._id);
      console.log(`Updated ${existing.email}: role set to ADMIN and password changed.`);
    } else {
      const user = await User.create({ firstname, lastname, email, password, role: 'ADMIN' });
      console.log(`Created ADMIN account ${user.email} (id ${user._id}).`);
    }
  } catch (error) {
    console.error(`Could not create the admin account: ${formatError(error)}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

main();
