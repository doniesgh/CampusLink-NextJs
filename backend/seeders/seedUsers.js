
const mongoose = require('mongoose');
const User = require('../models/userModel');
require('dotenv').config();

const users = [
  {
    firstname: 'Admin',
    lastname: 'CampusLink',
    email: 'admin@campuslink.com',
    password: 'Admin123!',
    role: 'ADMIN',
    locale: 'en',
  },
  {
    firstname: 'John',
    lastname: 'Smith',
    email: 'john.smith@campuslink.com',
    password: 'Student123!',
    role: 'STUDENT',
    locale: 'en',
  },
  {
    firstname: 'Sarah',
    lastname: 'Johnson',
    email: 'sarah.johnson@campuslink.com',
    password: 'Teacher123!',
    role: 'TEACHER',
    locale: 'en',
  },
  {
    firstname: 'Ahmed',
    lastname: 'Ben Ali',
    email: 'ahmed.benali@campuslink.com',
    password: 'Alumni123!',
    role: 'ALUMNI',
    locale: 'en',
  },
  {
    firstname: 'Marie',
    lastname: 'Dupont',
    email: 'marie.dupont@campuslink.com',
    password: 'Student123!',
    role: 'STUDENT',
    locale: 'fr',
  },
  {
    firstname: 'Youssef',
    lastname: 'Trabelsi',
    email: 'youssef.trabelsi@campuslink.com',
    password: 'Student123!',
    role: 'STUDENT',
    locale: 'en',
  },
];

async function seedUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log('Connected to MongoDB');

    let created = 0;
    let skipped = 0;

    for (const userData of users) {
      const email = userData.email.toLowerCase().trim();

      const existingUser = await User.findOne({ email })
        .setOptions({ populateGroup: false });

      if (existingUser) {
        console.log(`Skipped existing user: ${email}`);
        skipped++;
        continue;
      }

      // User.save() triggers the password hashing hook in userModel.
      const user = new User(userData);
      await user.save();

      console.log(`Created ${user.role}: ${user.email}`);
      created++;
    }

    console.log('\nUser seeding completed');
    console.log(`Created: ${created}`);
    console.log(`Skipped: ${skipped}`);
  } catch (error) {
    console.error('Error seeding users:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedUsers();