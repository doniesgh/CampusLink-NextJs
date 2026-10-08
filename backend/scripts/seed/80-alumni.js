// Seed plugin of Module 6 (alumni directory and network), run by `npm run seed:demo` after the core data.
// 8 alumni accounts (Selim Rekik from the core data + 7 more, password Campus123!) with profiles in several sectors
// (7 listed in the directory with a consent, 1 PRIVATE), mentoring requests from demo students in every state
// (PENDING, ACCEPTED, DECLINED, CLOSED) and news wall posts (one hidden by the moderation team).
// Idempotent: the alumni accounts are upserted (demo password reset), their profiles, posts and mentoring requests
// are deleted and created again. Companies and links are fictitious. Sends no notification.
const AlumniProfile = require('../../models/alumniProfileModel');
const MentoringRequest = require('../../models/mentoringRequestModel');
const AlumniPost = require('../../models/alumniPostModel');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EMAIL_DOMAIN = 'campuslink.local';

const text = (...lines) => lines.join('\n');

/*
 * Alumni (key → account + profile). `selim` already exists (core data). `consentDaysAgo`: when the profile was made
 * visible (CAMPUS); absent = PRIVATE profile.
 */
const ALUMNI = [
  {
    key: 'selim',
    firstname: 'Selim',
    lastname: 'Rekik',
    locale: 'fr',
    profile: {
      program: 'TWIN',
      promotion: 2019,
      headline: 'Lead développeur front-end chez Medina Soft',
      bio: text(
        'Diplômé TWIN en 2019. Je construis des applications web pour des clients en Tunisie et en Europe.',
        'J’aime transmettre : je donne régulièrement des ateliers React aux stagiaires.'
      ),
      skills: ['React', 'Node.js', 'TypeScript', 'MongoDB'],
      company: 'Medina Soft',
      jobTitle: 'Lead développeur front-end',
      sector: 'Software',
      city: 'Tunis',
      mentoringAvailable: true,
      mentoringTopics: ['Stage de fin d’études', 'Développement web', 'Entretiens techniques'],
      consentDaysAgo: 60,
    },
  },
  {
    key: 'rania',
    firstname: 'Rania',
    lastname: 'Gharsalli',
    locale: 'fr',
    profile: {
      program: 'DS',
      promotion: 2020,
      headline: 'Data scientist chez Carthage Data Lab',
      bio: text(
        'Je travaille sur la prévision de la demande et la détection de fraude.',
        'Avant ça : stage PFE en NLP sur des textes en arabe dialectal.'
      ),
      skills: ['Python', 'Machine learning', 'SQL', 'Power BI'],
      company: 'Carthage Data Lab',
      jobTitle: 'Data scientist',
      sector: 'Data & AI',
      city: 'Tunis',
      mentoringAvailable: true,
      mentoringTopics: ['Data science', 'Choix de spécialité', 'Projets personnels'],
      consentDaysAgo: 45,
    },
  },
  {
    key: 'walid',
    firstname: 'Walid',
    lastname: 'Mejdoub',
    locale: 'fr',
    profile: {
      program: 'TWIN',
      promotion: 2018,
      headline: 'Ingénieur cloud & DevOps chez Atlas Cloud Services',
      bio: 'Installé à Paris depuis 2020. Kubernetes, automatisation et un peu de FinOps.',
      skills: ['Kubernetes', 'AWS', 'Terraform', 'CI/CD'],
      company: 'Atlas Cloud Services',
      jobTitle: 'Ingénieur cloud & DevOps',
      sector: 'Cloud & DevOps',
      city: 'Paris',
      mentoringAvailable: true,
      mentoringTopics: ['Carrière à l’étranger', 'DevOps', 'Certifications cloud'],
      consentDaysAgo: 30,
    },
  },
  {
    key: 'emna',
    firstname: 'Emna',
    lastname: 'Chebbi',
    locale: 'en',
    profile: {
      program: 'SAE',
      promotion: 2017,
      headline: 'Product manager at Jasmin Pay',
      bio: 'From software engineering to product management. I lead the instant payments team.',
      skills: ['Product management', 'Scrum', 'UX research'],
      company: 'Jasmin Pay',
      jobTitle: 'Product manager',
      sector: 'Fintech',
      city: 'Montréal',
      mentoringAvailable: true,
      mentoringTopics: ['Product management', 'Agile', 'Working abroad'],
      consentDaysAgo: 40,
    },
  },
  {
    key: 'firas',
    firstname: 'Firas',
    lastname: 'Guesmi',
    locale: 'fr',
    profile: {
      program: 'TWIN',
      promotion: 2021,
      headline: 'Analyste cybersécurité chez Sahel Secure',
      bio: 'SOC, tests d’intrusion et sensibilisation. Pas disponible pour du mentorat ce trimestre, mais écris-moi sur LinkedIn.',
      skills: ['Pentest', 'SOC', 'Linux', 'Python'],
      company: 'Sahel Secure',
      jobTitle: 'Analyste cybersécurité',
      sector: 'Cybersecurity',
      city: 'Sousse',
      mentoringAvailable: false,
      mentoringTopics: ['Cybersécurité'],
      consentDaysAgo: 20,
    },
  },
  {
    key: 'hela',
    firstname: 'Hela',
    lastname: 'Tlili',
    locale: 'fr',
    profile: {
      program: 'SAE',
      promotion: 2016,
      headline: 'Architecte logiciel chez Olive Telecom',
      bio: 'Architecture de systèmes de facturation à grande échelle. Je recrute régulièrement des profils juniors.',
      skills: ['Java', 'Microservices', 'Kafka', 'Architecture logicielle'],
      company: 'Olive Telecom',
      jobTitle: 'Architecte logiciel',
      sector: 'Telecom',
      city: 'Sfax',
      mentoringAvailable: true,
      mentoringTopics: ['Architecture logicielle', 'Leadership technique', 'Premier emploi'],
      consentDaysAgo: 75,
    },
  },
  {
    key: 'mouna',
    firstname: 'Mouna',
    lastname: 'Kacem',
    locale: 'en',
    profile: {
      program: 'DS',
      promotion: 2022,
      headline: 'Machine learning engineer at MedAI Health',
      bio: 'Computer vision for medical imaging. Master’s degree in Germany after ESPRIT.',
      skills: ['PyTorch', 'MLOps', 'Computer vision', 'Python'],
      company: 'MedAI Health',
      jobTitle: 'Machine learning engineer',
      sector: 'E-health',
      city: 'Berlin',
      mentoringAvailable: true,
      mentoringTopics: ['Machine learning', 'Master’s abroad'],
      consentDaysAgo: 15,
    },
  },
  {
    key: 'bilel',
    firstname: 'Bilel',
    lastname: 'Saidi',
    locale: 'fr',
    profile: {
      program: 'TWIN',
      promotion: 2015,
      headline: 'Fondateur de Souk Digital',
      bio: 'Profil privé : visible seulement par moi et l’administration.',
      skills: ['Entrepreneuriat', 'E-commerce'],
      company: 'Souk Digital',
      jobTitle: 'Fondateur',
      sector: 'Entrepreneurship',
      city: 'Tunis',
      mentoringAvailable: false,
      mentoringTopics: [],
      // No consent: PRIVATE (not listed in the directory).
    },
  },
];

/*
 * Mentoring requests: `mentee` = demo student e-mail prefix, `mentor` = alumni key. `daysAgo` = creation;
 * `respondedHours` = answer delay; `closedDaysAgo` = closing date.
 */
const REQUESTS = [
  {
    mentee: 'yasmine.haddad',
    mentor: 'rania',
    status: 'PENDING',
    daysAgo: 2,
    topic: 'Data science',
    message: text(
      'Bonjour Rania, je suis en 4TWIN et j’hésite à me spécialiser en data science l’an prochain.',
      'Est-ce qu’on pourrait en parler 20 minutes ? Merci beaucoup !'
    ),
  },
  {
    mentee: 'yasmine.haddad',
    mentor: 'walid',
    status: 'PENDING',
    daysAgo: 1,
    topic: 'Stage à l’étranger',
    message: 'Bonjour Walid, je cherche un stage PFE en France dans le DevOps. Aurais-tu des conseils pour la candidature ?',
  },
  {
    mentee: 'ines.zouari',
    mentor: 'mouna',
    status: 'PENDING',
    daysAgo: 3,
    topic: 'Master’s abroad',
    message: 'Hello Mouna, I would like to apply for a master’s in machine learning in Germany. Could you share your experience?',
  },
  {
    mentee: 'omar.ferchichi',
    mentor: 'selim',
    status: 'ACCEPTED',
    daysAgo: 12,
    respondedHours: 20,
    topic: 'Technical interviews',
    message: 'Hi Selim, I have my first technical interviews next month for front-end internships. Could you help me prepare?',
    reply: 'Avec plaisir Omar ! Écris-moi par e-mail avec les offres qui t’intéressent, on fera une simulation d’entretien.',
  },
  {
    mentee: 'aya.khelifi',
    mentor: 'hela',
    status: 'ACCEPTED',
    daysAgo: 8,
    respondedHours: 6,
    topic: 'Architecture logicielle',
    message: 'Bonjour Hela, j’aimerais comprendre le métier d’architecte logiciel et les compétences à travailler dès maintenant.',
    reply: 'Bonjour Aya, bonne idée de t’y intéresser tôt. Envoie-moi un e-mail, je te propose un appel la semaine prochaine.',
  },
  {
    mentee: 'sarra.mansouri',
    mentor: 'firas',
    status: 'DECLINED',
    daysAgo: 25,
    respondedHours: 30,
    topic: 'Cybersécurité',
    message: 'Bonjour Firas, je voudrais me lancer dans les CTF et la cybersécurité. Par où commencer ?',
    reply: 'Désolé Sarra, je n’ai pas le temps ce trimestre. Commence par les challenges débutants de Root-Me, c’est très formateur.',
  },
  {
    mentee: 'ahmed.karray',
    mentor: 'walid',
    status: 'CLOSED',
    closedBy: 'MENTOR',
    daysAgo: 40,
    respondedHours: 12,
    closedDaysAgo: 10,
    topic: 'Certifications cloud',
    message: 'Salut Walid, quelle certification AWS me conseilles-tu pour commencer quand on est étudiant ?',
    reply: 'Commence par AWS Cloud Practitioner, puis Solutions Architect Associate. Écris-moi pour le plan de révision.',
  },
  {
    mentee: 'malek.ayari',
    mentor: 'rania',
    status: 'CLOSED',
    closedBy: 'MENTEE',
    daysAgo: 18,
    closedDaysAgo: 16,
    topic: 'Projets personnels',
    message: 'Bonjour Rania, j’aimerais des idées de projets personnels en data pour mon portfolio.',
  },
];

// News wall: `author` = alumni key, `daysAgo` = publication.
const POSTS = [
  {
    author: 'selim',
    type: 'NEW_JOB',
    daysAgo: 1,
    body: 'Nouvelle étape : je deviens lead développeur front-end chez Medina Soft. Merci à l’équipe TWIN pour les bases solides !',
  },
  {
    author: 'rania',
    type: 'OPPORTUNITY',
    daysAgo: 2,
    body: text(
      'Carthage Data Lab recrute 3 stagiaires PFE en data science (prévision, NLP, tableaux de bord).',
      'Envoyez-moi une demande de mentorat si vous voulez des conseils pour la candidature.'
    ),
    link: 'https://example.com/carthage-data-lab/stages-pfe',
  },
  {
    author: 'walid',
    type: 'EVENT',
    daysAgo: 4,
    body: 'Meetup Cloud Native le jeudi 22 octobre à 18 h à Tunis : Kubernetes en production, retours d’expérience. Gratuit, places limitées.',
    link: 'https://example.com/meetups/cloud-native-tunis',
  },
  {
    author: 'emna',
    type: 'ACHIEVEMENT',
    daysAgo: 6,
    body: 'Our team just launched instant payments for 200,000 users. Proud of what an ESPRIT-trained team can build!',
  },
  {
    author: 'hela',
    type: 'OPPORTUNITY',
    daysAgo: 9,
    body: 'Olive Telecom ouvre deux postes d’ingénieurs Java juniors à Sfax. Les diplômés 2026 sont les bienvenus.',
    link: 'https://example.com/olive-telecom/carrieres',
  },
  {
    author: 'mouna',
    type: 'OTHER',
    daysAgo: 12,
    body: 'Happy to answer questions about studying for a master’s in Germany: applications, scholarships, blocked account...',
  },
  {
    author: 'firas',
    type: 'ACHIEVEMENT',
    daysAgo: 15,
    body: 'Je viens d’obtenir la certification OSCP après six mois de préparation. Les CTF du club sécurité m’ont beaucoup aidé.',
  },
  {
    author: 'bilel',
    type: 'NEW_JOB',
    daysAgo: 20,
    body: 'Souk Digital fête ses trois ans : nous sommes maintenant douze, dont cinq anciens d’ESPRIT.',
  },
  {
    author: 'bilel',
    type: 'OTHER',
    daysAgo: 3,
    body: 'Promotion exceptionnelle sur la création de sites web, contactez-moi en privé pour un devis !',
    hidden: { reason: 'Publicité commerciale : le mur est réservé aux nouvelles du réseau.' },
  },
];

// Creates the account, or resets an existing one to the demo values (and the demo password).
const upsertAlumni = async (User, { firstname, lastname, locale }, password) => {
  const slug = (value) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const email = `${slug(firstname)}.${slug(lastname)}@${EMAIL_DOMAIN}`;
  const existing = await User.findOne({ email }).select('+password').setOptions({ populateGroup: false });
  if (!existing) return User.create({ firstname, lastname, email, password, role: 'ALUMNI', locale, group: null });
  existing.set({ firstname, lastname, role: 'ALUMNI', locale, group: null });
  if (!(await existing.comparePassword(password))) existing.password = password;
  await existing.save();
  return existing;
};

const run = async (ctx) => {
  const { models, now, password, programs, users } = ctx;
  const { User } = models;
  const ago = (days, hours = 0) => new Date(now.getTime() - days * DAY_MS + hours * HOUR_MS);

  // Accounts.
  const people = {};
  for (const person of ALUMNI) people[person.key] = await upsertAlumni(User, person, password);
  const alumniIds = Object.values(people).map((user) => user._id);
  const students = {};
  for (const student of users.students) students[student.email.split('@')[0]] = student;
  const studentIds = users.students.map((student) => student._id);

  // Reset: everything attached to the demo alumni, and the anonymized requests of the demo students.
  await Promise.all([
    AlumniProfile.deleteMany({ user: { $in: alumniIds } }),
    AlumniPost.deleteMany({ author: { $in: alumniIds } }),
    MentoringRequest.deleteMany({
      $or: [
        { mentor: { $in: alumniIds } },
        { mentee: { $in: alumniIds } },
        { mentee: { $in: studentIds }, mentor: null },
      ],
    }),
  ]);

  // Profiles.
  let listed = 0;
  for (const person of ALUMNI) {
    const { program, consentDaysAgo, ...fields } = person.profile;
    const createdAt = ago((consentDaysAgo ?? 90) + 5);
    const updatedAt = consentDaysAgo !== undefined ? ago(consentDaysAgo) : ago(30);
    const profile = new AlumniProfile({
      ...fields,
      user: people[person.key]._id,
      program: programs[program]?._id ?? null,
      linkedinUrl: null,
      visibility: consentDaysAgo !== undefined ? 'CAMPUS' : 'PRIVATE',
      consentAt: consentDaysAgo !== undefined ? ago(consentDaysAgo) : null,
      createdAt,
      updatedAt,
    });
    await profile.save({ timestamps: false });
    if (consentDaysAgo !== undefined) listed += 1;
  }

  // Mentoring requests (pending slots numbered per student, as the API does).
  const slots = new Map();
  let requests = 0;
  for (const item of REQUESTS) {
    const mentee = students[item.mentee];
    const mentor = people[item.mentor];
    if (!mentee || !mentor) continue;
    const createdAt = ago(item.daysAgo);
    let pendingSlot = null;
    if (item.status === 'PENDING') {
      pendingSlot = (slots.get(String(mentee._id)) ?? 0) + 1;
      slots.set(String(mentee._id), pendingSlot);
    }
    const respondedAt = item.respondedHours ? new Date(createdAt.getTime() + item.respondedHours * HOUR_MS) : null;
    const closedAt = item.closedDaysAgo !== undefined ? ago(item.closedDaysAgo) : null;
    await new MentoringRequest({
      mentor: mentor._id,
      mentee: mentee._id,
      mentorSnapshot: { firstname: mentor.firstname, lastname: mentor.lastname },
      menteeSnapshot: { firstname: mentee.firstname, lastname: mentee.lastname },
      topic: item.topic,
      message: item.message,
      reply: item.reply ?? null,
      status: item.status,
      pendingSlot,
      respondedAt,
      closedAt,
      closedBy: item.closedBy ?? null,
      createdAt,
      updatedAt: closedAt ?? respondedAt ?? createdAt,
    }).save({ timestamps: false });
    requests += 1;
  }

  // News wall.
  const admin = users.admin;
  let posts = 0;
  for (const item of POSTS) {
    const author = people[item.author];
    const createdAt = ago(item.daysAgo, -2);
    await new AlumniPost({
      author: author._id,
      authorSnapshot: { firstname: author.firstname, lastname: author.lastname },
      type: item.type,
      body: item.body,
      link: item.link ?? null,
      hidden: Boolean(item.hidden),
      hiddenAt: item.hidden ? new Date(createdAt.getTime() + 5 * HOUR_MS) : null,
      hiddenBy: item.hidden ? admin._id : null,
      hiddenReason: item.hidden?.reason ?? null,
      createdAt,
      updatedAt: createdAt,
    }).save({ timestamps: false });
    posts += 1;
  }

  ctx.log(
    `${ALUMNI.length} alumni accounts (${listed} listed, ${ALUMNI.length - listed} private), ${requests} mentoring requests, ${posts} posts.`
  );
  ctx.log(`Alumni accounts (password ${password}): ${Object.values(people).map((user) => user.email).join(', ')}`);
};

module.exports = { name: 'alumni', run };
