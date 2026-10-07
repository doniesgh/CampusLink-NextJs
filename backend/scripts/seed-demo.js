// Demo data for CampusLink: academic structure, accounts, then every scripts/seed/*.js plugin.
// Usage (in backend/): npm run seed:demo
// Idempotent (run it again to reset the demo data); refuses to run with NODE_ENV=production.
// Every demo account uses the password "Campus123!".
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const mongoose = require('mongoose');
const User = require('../models/userModel');
const Program = require('../models/programModel');
const Group = require('../models/groupModel');
const Subject = require('../models/subjectModel');
const Room = require('../models/roomModel');
const time = require('../utils/time');

const DEMO_PASSWORD = 'Campus123!';
const EMAIL_DOMAIN = 'campuslink.local';
// SEED_PLUGINS_DIR overrides the plugin folder (tests).
const PLUGINS_DIR = process.env.SEED_PLUGINS_DIR ? path.resolve(process.env.SEED_PLUGINS_DIR) : path.join(__dirname, 'seed');

const PROGRAMS = [
  {
    code: 'TWIN',
    name: "Technologies du Web et de l'Internet",
    description: 'Développement web et mobile, cloud et architectures distribuées.',
  },
  { code: 'DS', name: 'Data Science', description: 'Données, apprentissage automatique et aide à la décision.' },
  {
    code: 'SAE',
    name: 'Architecture des systèmes logiciels',
    description: 'Conception, qualité et industrialisation du logiciel.',
  },
];

// Level 4 groups of the current academic year.
const GROUPS = [
  { name: '4TWIN1', program: 'TWIN' },
  { name: '4TWIN2', program: 'TWIN' },
  { name: '4DS1', program: 'DS' },
  { name: '4SAE1', program: 'SAE' },
];

const SUBJECTS = [
  { code: 'BDD', name: 'Bases de données', color: '#253C6D' },
  { code: 'WEB', name: 'Développement web avancé', color: '#1F7A8C' },
  { code: 'ML', name: 'Machine learning', color: '#2E7D32' },
  { code: 'ARCH', name: 'Architecture logicielle', color: '#B4531A' },
  { code: 'ENG', name: 'Anglais professionnel', color: '#8E24AA' },
  { code: 'AGILE', name: 'Gestion de projet agile', color: '#C62828' },
];

const ROOMS = [
  { name: 'A04', building: 'Bloc A', capacity: 40, type: 'CLASSROOM' },
  { name: 'A12', building: 'Bloc A', capacity: 40, type: 'CLASSROOM' },
  { name: 'B12', building: 'Bloc B', capacity: 36, type: 'CLASSROOM' },
  { name: 'C201', building: 'Bloc C', capacity: 24, type: 'LAB' },
  { name: 'C202', building: 'Bloc C', capacity: 24, type: 'LAB' },
  { name: 'Amphi A', building: 'Bloc A', capacity: 200, type: 'AMPHITHEATER' },
];

const ADMIN = { firstname: 'Admin', lastname: 'CampusLink', email: `admin@${EMAIL_DOMAIN}`, locale: 'fr' };

const TEACHERS = [
  { firstname: 'Amira', lastname: 'Ben Salah', locale: 'fr' },
  { firstname: 'Karim', lastname: 'Trabelsi', locale: 'fr' },
  { firstname: 'Leila', lastname: 'Gharbi', locale: 'en' },
  { firstname: 'Mehdi', lastname: 'Jaziri', locale: 'fr' },
];

const STUDENTS = [
  { firstname: 'Yasmine', lastname: 'Haddad', group: '4TWIN1', locale: 'fr' },
  { firstname: 'Omar', lastname: 'Ferchichi', group: '4TWIN1', locale: 'en' },
  { firstname: 'Sarra', lastname: 'Mansouri', group: '4TWIN1', locale: 'fr' },
  { firstname: 'Ahmed', lastname: 'Karray', group: '4TWIN2', locale: 'fr' },
  { firstname: 'Nour', lastname: 'Chaabane', group: '4TWIN2', locale: 'fr' },
  { firstname: 'Rami', lastname: 'Belhaj', group: '4TWIN2', locale: 'en' },
  { firstname: 'Ines', lastname: 'Zouari', group: '4DS1', locale: 'fr' },
  { firstname: 'Youssef', lastname: 'Hammami', group: '4DS1', locale: 'fr' },
  { firstname: 'Malek', lastname: 'Ayari', group: '4DS1', locale: 'fr' },
  { firstname: 'Aya', lastname: 'Khelifi', group: '4SAE1', locale: 'fr' },
  { firstname: 'Hamza', lastname: 'Dridi', group: '4SAE1', locale: 'fr' },
  { firstname: 'Lina', lastname: 'Bouazizi', group: '4SAE1', locale: 'en' },
  // A student without a group (the timetable shows "You're not assigned to a group yet.").
  { firstname: 'Skander', lastname: 'Mejri', group: null, locale: 'fr' },
];

const ALUMNI = [{ firstname: 'Selim', lastname: 'Rekik', locale: 'fr' }];

// Who teaches what to whom: a suggestion for the timetable plugin (subject code, teacher index, groups).
const TEACHING = [
  { subject: 'BDD', teacher: 0, groups: ['4TWIN1', '4TWIN2'] },
  { subject: 'WEB', teacher: 1, groups: ['4TWIN1'] },
  { subject: 'WEB', teacher: 1, groups: ['4TWIN2'] },
  { subject: 'ML', teacher: 2, groups: ['4DS1'] },
  { subject: 'ARCH', teacher: 3, groups: ['4SAE1'] },
  { subject: 'ENG', teacher: 2, groups: ['4TWIN1', '4TWIN2', '4DS1', '4SAE1'] },
  { subject: 'AGILE', teacher: 3, groups: ['4DS1', '4SAE1'] },
  { subject: 'BDD', teacher: 0, groups: ['4DS1'] },
];

// "Leïla Ben Salah" → "leila.bensalah@campuslink.local"
const emailFor = ({ firstname, lastname }) => {
  const slug = (value) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  return `${slug(firstname)}.${slug(lastname)}@${EMAIL_DOMAIN}`;
};

const upsert = (Model, filter, values, collation) => {
  const query = Model.findOneAndUpdate(
    filter,
    { $set: values },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
  );
  if (collation) query.collation(collation);
  return query;
};

// Creates the account, or resets an existing one to the demo values (and the demo password).
const upsertUser = async ({ firstname, lastname, email, role, locale = 'fr', group = null }) => {
  const existing = await User.findOne({ email }).select('+password');
  if (!existing) {
    return User.create({ firstname, lastname, email, password: DEMO_PASSWORD, role, locale, group });
  }
  existing.set({ firstname, lastname, role, locale, group });
  if (!(await existing.comparePassword(DEMO_PASSWORD))) existing.password = DEMO_PASSWORD;
  await existing.save();
  return existing;
};

// scripts/seed/*.js in name order. A plugin exports `async (ctx) => {}` (or `{ name, run }`).
const loadPlugins = () => {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  return fs
    .readdirSync(PLUGINS_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const exported = require(path.join(PLUGINS_DIR, file));
      const run = typeof exported === 'function' ? exported : exported?.run;
      if (typeof run !== 'function') throw new Error(`scripts/seed/${file} must export a function or { run }`);
      return { file, name: exported.name && typeof exported.name === 'string' ? exported.name : file, run };
    });
};

const seedCore = async () => {
  const academicYear = time.currentAcademicYear();

  const programs = {};
  for (const program of PROGRAMS) {
    programs[program.code] = await upsert(Program, { code: program.code }, program);
  }

  const groups = {};
  for (const group of GROUPS) {
    groups[group.name] = await upsert(
      Group,
      { name: group.name, academicYear },
      { name: group.name, academicYear, level: 4, program: programs[group.program]._id },
      Group.NAME_COLLATION
    );
  }

  const subjects = {};
  for (const subject of SUBJECTS) {
    subjects[subject.code] = await upsert(Subject, { code: subject.code }, subject);
  }

  const rooms = {};
  for (const room of ROOMS) {
    rooms[room.name] = await upsert(Room, { name: room.name }, room, Room.NAME_COLLATION);
  }

  const admin = await upsertUser({ ...ADMIN, role: 'ADMIN' });
  const teachers = [];
  for (const teacher of TEACHERS) {
    teachers.push(await upsertUser({ ...teacher, email: emailFor(teacher), role: 'TEACHER' }));
  }
  const students = [];
  const studentsByGroup = Object.fromEntries(GROUPS.map(({ name }) => [name, []]));
  for (const student of STUDENTS) {
    const doc = await upsertUser({
      ...student,
      email: emailFor(student),
      role: 'STUDENT',
      group: student.group ? groups[student.group]._id : null,
    });
    students.push(doc);
    if (student.group) studentsByGroup[student.group].push(doc);
  }
  const alumni = [];
  for (const person of ALUMNI) {
    alumni.push(await upsertUser({ ...person, email: emailFor(person), role: 'ALUMNI' }));
  }

  const all = [admin, ...teachers, ...students, ...alumni];
  const users = {
    admin,
    teachers,
    students,
    alumni,
    studentsByGroup,
    byEmail: Object.fromEntries(all.map((user) => [user.email, user])),
  };

  const teaching = TEACHING.map(({ subject, teacher, groups: names }) => ({
    subject: subjects[subject],
    teacher: teachers[teacher],
    groups: names.map((name) => groups[name]),
  }));

  console.log(
    `Academic year ${academicYear}: ${PROGRAMS.length} programs, ${GROUPS.length} groups, ${SUBJECTS.length} subjects, ${ROOMS.length} rooms, ${all.length} accounts.`
  );
  return { academicYear, programs, groups, subjects, rooms, users, teaching };
};

const printAccounts = (users) => {
  const rows = [
    ['ADMIN', users.admin, ''],
    ...users.teachers.map((user) => ['TEACHER', user, '']),
    ...users.students.map((user) => ['STUDENT', user, user.group?.name ?? '(no group)']),
    ...users.alumni.map((user) => ['ALUMNI', user, '']),
  ];
  console.log(`\nDemo accounts (password for all: ${DEMO_PASSWORD})`);
  rows.forEach(([role, user, group]) => {
    const name = `${user.firstname} ${user.lastname}`;
    console.log(`  ${role.padEnd(8)} ${user.email.padEnd(40)} ${name.padEnd(22)} ${user.locale}  ${group}`);
  });
};

const main = async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('seed:demo refuses to run with NODE_ENV=production.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Add it to backend/.env (see backend/.env.example).');
    process.exitCode = 1;
    return;
  }

  let plugins;
  try {
    plugins = loadPlugins();
  } catch (error) {
    console.error(`Could not load the seed plugins: ${error.message}`);
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
    // Indexes of every registered model (including the plugins' models).
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

    const core = await seedCore();
    // Reload users so their group is populated (the public shape).
    const reload = async (list) => Promise.all(list.map((user) => User.findById(user._id)));
    core.users.students = await reload(core.users.students);
    Object.keys(core.users.studentsByGroup).forEach((name) => {
      core.users.studentsByGroup[name] = core.users.students.filter((user) => user.group?.name === name);
    });
    core.users.byEmail = Object.fromEntries(
      [core.users.admin, ...core.users.teachers, ...core.users.students, ...core.users.alumni].map((user) => [
        user.email,
        user,
      ])
    );

    const ctx = {
      ...core,
      mongoose,
      models: mongoose.models,
      password: DEMO_PASSWORD,
      timezone: time.getAppTimezone(),
      now: new Date(),
      time,
      log: (message) => console.log(`  ${message}`),
    };

    for (const plugin of plugins) {
      console.log(`Seed plugin ${plugin.file}...`);
      try {
        await plugin.run(ctx);
      } catch (error) {
        console.error(`  failed: ${error.stack || error.message}`);
        process.exitCode = 1;
      }
    }

    printAccounts(core.users);
  } catch (error) {
    console.error(`Could not seed the demo data: ${error.stack || error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

main();
