// Seed plugin of Module 3 (notes marketplace), run by `npm run seed:demo` after the core data.
// Published free and premium documents (small generated PDFs), one document waiting for a review, one rejected,
// purchases (with the matching wallet ledger), free downloads, reviews and reports.
// Idempotent: the demo documents (same author and title) are deleted with their files, purchases, ledger entries,
// reviews and reports, then created again; the wallets of the users involved are rebuilt from their ledger.
// Sends no notification. Run it while the API is idle (wallet holds of purchases in progress are cleared).
const PDFDocument = require('pdfkit');
const MarketDocument = require('../../models/marketDocumentModel');
const MarketPurchase = require('../../models/marketPurchaseModel');
const MarketReview = require('../../models/marketReviewModel');
const MarketReport = require('../../models/marketReportModel');
const Wallet = require('../../models/walletModel');
const WalletTransaction = require('../../models/walletTransactionModel');
const storageService = require('../../service/storageService');
const walletService = require('../../service/walletService');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DOMAIN = 'campuslink.local';
const BRAND = '#253C6D';

/*
 * Demo documents. `author` and the people below are e-mail local parts ("admin" = the administrator).
 * `daysAgo`: publication (or submission) date. Sections become the content of the generated PDF.
 */
const DOCUMENTS = [
  {
    key: 'sql',
    author: 'yasmine.haddad',
    subject: 'BDD',
    type: 'SUMMARY',
    price: 0,
    level: 4,
    professor: 'Amira Ben Salah',
    daysAgo: 26,
    title: 'Résumé SQL : jointures, GROUP BY et sous-requêtes',
    description:
      'Mon résumé de révision pour le contrôle de bases de données : les différents JOIN avec des schémas, GROUP BY / HAVING et les sous-requêtes, avec des exemples sur la base "école".',
    filename: 'resume-sql-jointures.pdf',
    sections: [
      ['Jointures', ['INNER JOIN : seulement les lignes qui correspondent des deux côtés.', 'LEFT JOIN : toutes les lignes de gauche, NULL à droite sans correspondance.', 'Trouver les absents : LEFT JOIN ... WHERE droite.id IS NULL.']],
      ['Agrégation', ['GROUP BY regroupe, COUNT/SUM/AVG calculent par groupe.', 'WHERE filtre les lignes avant, HAVING filtre les groupes après.']],
      ['Sous-requêtes', ['IN / EXISTS pour tester une appartenance.', 'Sous-requête corrélée : réévaluée pour chaque ligne.']],
    ],
  },
  {
    key: 'normalization',
    author: 'omar.ferchichi',
    subject: 'BDD',
    type: 'SUMMARY',
    price: 5,
    level: 4,
    professor: 'Amira Ben Salah',
    daysAgo: 22,
    title: 'Normalization cheat sheet (1NF to BCNF)',
    description:
      'One page per normal form with a counter-example and the fix. Functional dependencies, keys and the decomposition steps we used in the tutorials.',
    filename: 'normalization-cheat-sheet.pdf',
    sections: [
      ['Functional dependencies', ['X -> Y: two rows with the same X have the same Y.', 'A key determines every attribute; a minimal one is a candidate key.']],
      ['Normal forms', ['1NF: atomic values, no repeating groups.', '2NF: no partial dependency on a composite key.', '3NF: no transitive dependency.', 'BCNF: every determinant is a candidate key.']],
    ],
  },
  {
    key: 'td-bdd',
    author: 'ahmed.karray',
    subject: 'BDD',
    type: 'EXERCISES',
    price: 10,
    level: 4,
    professor: 'Amira Ben Salah',
    daysAgo: 18,
    title: 'Corrigés des TD 3 à 5 — Bases de données',
    description:
      'Mes corrections détaillées des TD 3 (requêtes), 4 (vues et index) et 5 (transactions), avec les erreurs fréquentes à éviter.',
    filename: 'corriges-td3-td5-bdd.pdf',
    sections: [
      ['TD 3 — Requêtes', ['Exercice 1 : SELECT avec jointure sur trois tables.', 'Exercice 4 : GROUP BY + HAVING COUNT(*) > 3.']],
      ['TD 4 — Vues et index', ['Une vue simplifie les requêtes fréquentes.', 'Un index accélère les lectures mais ralentit les écritures.']],
      ['TD 5 — Transactions', ['ACID : atomicité, cohérence, isolation, durabilité.', 'Lecture sale, lecture non répétable, lecture fantôme.']],
    ],
  },
  {
    key: 'react',
    author: 'karim.trabelsi',
    subject: 'WEB',
    type: 'COURSE_NOTES',
    price: 0,
    level: 4,
    professor: 'Karim Trabelsi',
    daysAgo: 30,
    title: 'Cours React : composants, hooks et état',
    description: 'Support de cours complet du chapitre React : composants, props, état, useEffect, formulaires contrôlés.',
    filename: 'cours-react-hooks.pdf',
    sections: [
      ['Composants', ['Une fonction qui reçoit des props et renvoie du JSX.', 'Les props descendent, les événements remontent.']],
      ['Hooks', ['useState : un état local.', 'useEffect : synchroniser avec l’extérieur (avec ses dépendances).', 'useMemo / useCallback : éviter des calculs inutiles.']],
    ],
  },
  {
    key: 'exam-web',
    author: 'yasmine.haddad',
    subject: 'WEB',
    type: 'EXAM_PREP',
    price: 15,
    level: 4,
    professor: 'Karim Trabelsi',
    daysAgo: 12,
    title: 'Préparation examen Web : sujets corrigés 2024 et 2025',
    description: 'Les deux derniers sujets d’examen de technologies web, corrigés pas à pas, avec un barème indicatif.',
    filename: 'examen-web-corriges.pdf',
    sections: [
      ['Sujet 2024', ['Partie 1 : HTTP, cookies et sessions.', 'Partie 2 : une API REST avec Express.']],
      ['Sujet 2025', ['Partie 1 : rendu serveur et hydratation.', 'Partie 2 : un formulaire React accessible.']],
    ],
  },
  {
    key: 'ml',
    author: 'leila.gharbi',
    subject: 'ML',
    type: 'COURSE_NOTES',
    price: 0,
    level: 4,
    professor: 'Leila Gharbi',
    daysAgo: 28,
    title: 'Machine Learning: regression and classification notes',
    description: 'Lecture notes of chapters 2 and 3: linear and logistic regression, metrics, overfitting and cross-validation.',
    filename: 'ml-regression-classification.pdf',
    sections: [
      ['Regression', ['Linear regression minimizes the squared error.', 'Regularization (L1, L2) limits overfitting.']],
      ['Classification', ['Logistic regression outputs a probability.', 'Precision, recall and F1 when classes are unbalanced.', 'Use cross-validation to choose hyperparameters.']],
    ],
  },
  {
    key: 'nn',
    author: 'ines.zouari',
    subject: 'ML',
    type: 'EXERCISES',
    price: 12,
    level: 4,
    professor: 'Leila Gharbi',
    daysAgo: 10,
    title: 'Exercices corrigés : réseaux de neurones',
    description: 'Dix exercices sur la rétropropagation, les fonctions d’activation et le choix du taux d’apprentissage, corrigés.',
    filename: 'exercices-reseaux-neurones.pdf',
    sections: [
      ['Rétropropagation', ['Calcul du gradient couche par couche (règle de la chaîne).', 'Exercice 3 : un réseau 2-2-1 à la main.']],
      ['Entraînement', ['Taux d’apprentissage trop grand : la perte diverge.', 'ReLU évite la disparition du gradient.']],
    ],
  },
  {
    key: 'microservices',
    author: 'mehdi.jaziri',
    subject: 'ARCH',
    type: 'SLIDES',
    price: 0,
    level: 4,
    professor: 'Mehdi Jaziri',
    daysAgo: 16,
    title: 'Slides : architecture microservices en 20 diapos',
    description: 'Les diapositives du cours sur les microservices : découpage, communication, passerelle API et observabilité.',
    filename: 'slides-microservices.pdf',
    sections: [
      ['Découpage', ['Un service par contexte métier.', 'Chaque service possède ses données.']],
      ['Communication', ['Synchrone (REST, gRPC) ou asynchrone (messages).', 'Passerelle API, découverte de services, disjoncteur.']],
    ],
  },
  {
    key: 'interview',
    author: 'sarra.mansouri',
    subject: 'ENG',
    type: 'SUMMARY',
    price: 3,
    level: 4,
    professor: 'Leila Gharbi',
    daysAgo: 8,
    title: 'Job interview English: useful phrases',
    description: 'Phrases to introduce yourself, talk about a project and answer the classic questions of an internship interview.',
    filename: 'job-interview-phrases.pdf',
    sections: [
      ['Introducing yourself', ['I am a fourth-year software engineering student at ESPRIT.', 'I am particularly interested in web development.']],
      ['Talking about a project', ['I was in charge of the back end.', 'The main challenge was ... and we solved it by ...']],
    ],
  },
  {
    key: 'scrum',
    author: 'malek.ayari',
    subject: 'AGILE',
    type: 'SUMMARY',
    price: 0,
    level: 4,
    professor: 'Mehdi Jaziri',
    daysAgo: 6,
    title: 'Scrum en une page : rôles, cérémonies, artefacts',
    description: 'Tout Scrum sur une page pour réviser vite : les trois rôles, les cinq événements et les trois artefacts.',
    filename: 'scrum-une-page.pdf',
    sections: [
      ['Rôles', ['Product Owner, Scrum Master, équipe de développement.']],
      ['Événements', ['Sprint, planification, mêlée quotidienne, revue, rétrospective.']],
      ['Artefacts', ['Product backlog, sprint backlog, incrément.']],
    ],
  },
  {
    key: 'transactions',
    author: 'nour.chaabane',
    subject: 'BDD',
    type: 'COURSE_NOTES',
    price: 8,
    level: 4,
    professor: 'Amira Ben Salah',
    daysAgo: 1,
    status: 'PENDING_REVIEW',
    title: 'Notes de cours : transactions et contrôle de concurrence',
    description: 'Mes notes du chapitre 6 : verrouillage à deux phases, niveaux d’isolation et interblocages.',
    filename: 'notes-transactions.pdf',
    sections: [
      ['Verrouillage', ['Verrou partagé (lecture) et exclusif (écriture).', 'Verrouillage à deux phases : croissance puis décroissance.']],
      ['Isolation', ['READ COMMITTED, REPEATABLE READ, SERIALIZABLE.']],
    ],
  },
  {
    key: 'blurry',
    author: 'rami.belhaj',
    subject: 'WEB',
    type: 'OTHER',
    price: 2,
    level: 4,
    professor: 'Karim Trabelsi',
    daysAgo: 4,
    status: 'REJECTED',
    rejectionReason: 'Les photos sont floues et illisibles : envoie plutôt un PDF net.',
    title: 'Photos du tableau — cours Web du 2 octobre',
    description: 'Photos prises pendant le cours.',
    filename: 'photos-tableau-web.pdf',
    sections: [['Photos', ['(photos du tableau)']]],
  },
];

// Premium purchases: [document, buyer, daysAgo, downloaded?].
const PURCHASES = [
  ['normalization', 'yasmine.haddad', 20, true],
  ['normalization', 'sarra.mansouri', 19, true],
  ['normalization', 'ahmed.karray', 15, true],
  ['normalization', 'nour.chaabane', 9, true],
  ['td-bdd', 'yasmine.haddad', 17, true],
  ['td-bdd', 'omar.ferchichi', 16, true],
  ['td-bdd', 'nour.chaabane', 12, true],
  ['td-bdd', 'mariem.jlassi', 5, true],
  ['exam-web', 'omar.ferchichi', 11, true],
  ['exam-web', 'ahmed.karray', 10, true],
  ['exam-web', 'aziz.benamor', 7, true],
  ['exam-web', 'mariem.jlassi', 4, true],
  ['exam-web', 'rami.belhaj', 2, false],
  ['nn', 'youssef.hammami', 9, true],
  ['nn', 'malek.ayari', 6, true],
  ['interview', 'yasmine.haddad', 7, true],
  ['interview', 'lina.bouazizi', 3, true],
];

// Downloads of free documents: [document, user, daysAgo].
const FREE_DOWNLOADS = [
  ['sql', 'omar.ferchichi', 25],
  ['sql', 'sarra.mansouri', 24],
  ['sql', 'ahmed.karray', 22],
  ['sql', 'nour.chaabane', 20],
  ['sql', 'mariem.jlassi', 14],
  ['sql', 'aziz.benamor', 13],
  ['sql', 'rami.belhaj', 6],
  ['react', 'yasmine.haddad', 29],
  ['react', 'omar.ferchichi', 28],
  ['react', 'ahmed.karray', 27],
  ['react', 'nour.chaabane', 21],
  ['react', 'rami.belhaj', 12],
  ['react', 'sarra.mansouri', 8],
  ['ml', 'ines.zouari', 27],
  ['ml', 'youssef.hammami', 26],
  ['ml', 'malek.ayari', 20],
  ['ml', 'omar.ferchichi', 15],
  ['ml', 'lina.bouazizi', 10],
  ['microservices', 'aya.khelifi', 15],
  ['microservices', 'hamza.dridi', 14],
  ['microservices', 'lina.bouazizi', 9],
  ['scrum', 'ines.zouari', 5],
  ['scrum', 'youssef.hammami', 5],
  ['scrum', 'aya.khelifi', 4],
  ['scrum', 'hamza.dridi', 2],
];

// Reviews (the reviewer bought or downloaded the document): [document, user, rating, comment, daysAgo].
const REVIEWS = [
  ['sql', 'omar.ferchichi', 5, 'Very clear, the LEFT JOIN examples saved me.', 24],
  ['sql', 'sarra.mansouri', 4, 'Très bien fait, merci !', 23],
  ['sql', 'ahmed.karray', 5, 'Parfait pour réviser la veille du contrôle.', 21],
  ['sql', 'rami.belhaj', 3, 'Bien, mais il manque les sous-requêtes corrélées.', 5],
  ['normalization', 'yasmine.haddad', 5, 'Parfait pour comprendre la BCNF.', 19],
  ['normalization', 'nour.chaabane', 4, '', 8],
  ['td-bdd', 'yasmine.haddad', 4, 'Corrections justes, un peu courtes sur le TD 5.', 16],
  ['td-bdd', 'omar.ferchichi', 5, 'Detailed and correct, worth the tokens.', 15],
  ['td-bdd', 'mariem.jlassi', 2, 'Certaines corrections ne sont pas expliquées.', 4],
  ['react', 'yasmine.haddad', 5, 'Le meilleur support sur les hooks.', 28],
  ['react', 'ahmed.karray', 4, '', 26],
  ['react', 'nour.chaabane', 5, 'Clair et bien structuré.', 20],
  ['exam-web', 'omar.ferchichi', 5, 'The corrections follow the marking scheme, very useful.', 10],
  ['exam-web', 'ahmed.karray', 4, 'Très utile, quelques coquilles.', 9],
  ['exam-web', 'aziz.benamor', 5, 'Je me sens prêt pour l’examen.', 6],
  ['ml', 'ines.zouari', 5, 'Les métriques sont enfin claires pour moi.', 26],
  ['ml', 'youssef.hammami', 4, '', 25],
  ['ml', 'lina.bouazizi', 5, 'Clear and well structured.', 9],
  ['nn', 'youssef.hammami', 4, 'Bons exercices, la correction du 7 m’a beaucoup aidé.', 8],
  ['microservices', 'aya.khelifi', 4, 'Diapos claires.', 14],
  ['scrum', 'ines.zouari', 5, 'Exactement ce qu’il faut avant le QCM.', 4],
  ['scrum', 'aya.khelifi', 4, '', 3],
  ['interview', 'lina.bouazizi', 4, 'Useful phrases, a few more examples would help.', 2],
];

// Reports: [document, reporter, reason, daysAgo, resolution?].
const REPORTS = [
  ['td-bdd', 'sarra.mansouri', 'Ce sont les corrigés distribués par la prof : ils ne devraient pas être vendus.', 3],
  ['td-bdd', 'hamza.dridi', 'Corrigés officiels revendus sans autorisation.', 2],
  [
    'scrum',
    'rami.belhaj',
    'Le document est beaucoup trop court.',
    3,
    { outcome: 'NO_ACTION', note: 'Le contenu est correct et gratuit : aucune action.', daysAgo: 2 },
  ],
];

// Small PDF (A4, standard Helvetica fonts) with a title, a subtitle and bullet sections.
const makePdf = ({ title, subtitle, sections }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: title, Author: 'CampusLink (demo)' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(BRAND).text(title);
    doc.moveDown(0.3).font('Helvetica').fontSize(11).fillColor('#555555').text(subtitle);
    doc.moveDown();
    sections.forEach(([heading, lines]) => {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND).text(heading);
      doc.moveDown(0.2).font('Helvetica').fontSize(11).fillColor('#111111');
      lines.forEach((line) => doc.text(`•  ${line}`, { indent: 8 }));
      doc.moveDown(0.6);
    });
    doc.moveDown().font('Helvetica-Oblique').fontSize(8).fillColor('#888888');
    doc.text('Document de démonstration généré par CampusLink — demo document generated by CampusLink.');
    doc.end();
  });

// Removes the previous demo documents (same author and title, or same author and file name: a demo document renamed
// by hand) with their files, purchases, ledger entries, reviews and reports. Returns the ids of the users whose
// wallet changes (buyers and authors of the removed purchases).
const removePrevious = async (person) => {
  const previous = await MarketDocument.find({
    $or: DOCUMENTS.flatMap((item) => [
      { author: person(item.author)._id, title: item.title },
      { author: person(item.author)._id, 'file.filename': item.filename },
    ]),
  }).lean();
  const previousIds = previous.map((doc) => doc._id);
  const purchases = await MarketPurchase.find({ document: { $in: previousIds }, kind: 'PURCHASE' }).lean();
  const affected = new Set();
  purchases.forEach((item) => {
    affected.add(String(item.buyer));
    if (item.seller) affected.add(String(item.seller));
  });
  await WalletTransaction.deleteMany({ purchase: { $in: purchases.map((item) => item._id) } });
  await Promise.all([
    MarketPurchase.deleteMany({ document: { $in: previousIds } }),
    MarketReview.deleteMany({ document: { $in: previousIds } }),
    MarketReport.deleteMany({ document: { $in: previousIds } }),
  ]);
  await MarketDocument.deleteMany({ _id: { $in: previousIds } });
  await Promise.all(previous.map((doc) => (doc.file?.key ? storageService.remove(doc.file.key).catch(() => {}) : null)));
  return affected;
};

// One demo document with its generated PDF (saved through storageService, folder "marketplace").
const createDocument = async (item, { person, subjects, academicYear, admin, at }) => {
  const author = person(item.author);
  const subject = subjects[item.subject];
  const buffer = await makePdf({
    title: item.title,
    subtitle: `${subject.name} · ${item.professor} · ${author.firstname} ${author.lastname}`,
    sections: item.sections,
  });
  const file = await storageService.save({ buffer, originalName: item.filename, mimeType: 'application/pdf', folder: 'marketplace' });
  const status = item.status ?? 'PUBLISHED';
  const createdAt = at(item.daysAgo, -2);
  const reviewedAt = status === 'PENDING_REVIEW' ? null : at(item.daysAgo);
  const doc = new MarketDocument({
    title: item.title,
    description: item.description,
    subject: subject._id,
    level: item.level,
    academicYear,
    professor: item.professor,
    type: item.type,
    file,
    price: item.price,
    author: author._id,
    authorSnapshot: { firstname: author.firstname, lastname: author.lastname },
    status,
    rejectionReason: item.rejectionReason ?? null,
    submittedAt: createdAt,
    reviewedAt,
    reviewedBy: reviewedAt ? admin._id : null,
    publishedAt: status === 'PUBLISHED' ? at(item.daysAgo) : null,
    createdAt,
    updatedAt: reviewedAt ?? createdAt,
  });
  await doc.save({ timestamps: false });
  return doc;
};

// A COMPLETED purchase (+ the PURCHASE / SALE ledger entries) or a FREE acquisition (first download).
const createAcquisition = async (doc, buyer, date, { paid, downloaded }) => {
  const downloadedAt = downloaded ? new Date(date.getTime() + (paid ? HOUR_MS : 0)) : null;
  const acquisition = new MarketPurchase({
    buyer: buyer._id,
    document: doc._id,
    seller: doc.author,
    kind: paid ? 'PURCHASE' : 'FREE',
    price: paid ? doc.price : 0,
    state: 'COMPLETED',
    documentTitle: doc.title,
    completedAt: date,
    firstDownloadAt: downloadedAt,
    lastDownloadAt: downloadedAt,
    downloadCount: downloaded ? 1 : 0,
    createdAt: date,
    updatedAt: date,
  });
  await acquisition.save({ timestamps: false });
  if (paid) {
    const entry = { document: doc._id, documentTitle: doc.title, purchase: acquisition._id, createdAt: date };
    await new WalletTransaction({ ...entry, user: buyer._id, type: 'PURCHASE', amount: -doc.price, key: `purchase:${acquisition._id}` }).save({ timestamps: false });
    await new WalletTransaction({ ...entry, user: doc.author, type: 'SALE', amount: doc.price, key: `sale:${acquisition._id}` }).save({ timestamps: false });
  }
  return acquisition;
};

// downloads (distinct users), sales and rating of a document, from the data.
const refreshCounters = async (doc) => {
  const [downloads, sales, ratings] = await Promise.all([
    MarketPurchase.countDocuments({ document: doc._id, firstDownloadAt: { $ne: null } }),
    MarketPurchase.countDocuments({ document: doc._id, kind: 'PURCHASE' }),
    MarketReview.find({ document: doc._id }).select('rating').lean(),
  ]);
  const ratingSum = ratings.reduce((total, review) => total + review.rating, 0);
  const ratingCount = ratings.length;
  const rating = ratingCount ? Math.round((ratingSum / ratingCount) * 100) / 100 : 0;
  await MarketDocument.collection.updateOne({ _id: doc._id }, { $set: { downloads, sales, ratingSum, ratingCount, rating } });
};

// Wallet of a user rebuilt from the ledger (starting tokens dated before the demo history, balanceAfter recomputed).
// Returns false when the ledger is negative (the wallet is then set to 0).
const rebuildWallet = async (userId, bonusDate) => {
  const start = walletService.startingTokens();
  const bonusKey = `start:${userId}`;
  const bonus = await WalletTransaction.findOne({ key: bonusKey }).lean();
  if (!bonus && start > 0) {
    await new WalletTransaction({ user: userId, type: 'STARTING_BONUS', amount: start, key: bonusKey, createdAt: bonusDate }).save({
      timestamps: false,
    });
  } else if (bonus && bonus.createdAt > bonusDate) {
    // createdAt is immutable in Mongoose: older starting date for a readable demo history.
    await WalletTransaction.collection.updateOne({ _id: bonus._id }, { $set: { createdAt: bonusDate } });
  }
  const entries = await WalletTransaction.find({ user: userId }).sort({ createdAt: 1, _id: 1 }).lean();
  let balance = 0;
  const updates = [];
  entries.forEach((entry) => {
    balance += entry.amount;
    if (entry.balanceAfter !== balance) {
      updates.push({ updateOne: { filter: { _id: entry._id }, update: { $set: { balanceAfter: balance } } } });
    }
  });
  if (updates.length > 0) await WalletTransaction.bulkWrite(updates);
  await Wallet.updateOne({ user: userId }, { $set: { balance: Math.max(0, balance), pending: [] } }, { upsert: true });
  return balance >= 0;
};

module.exports = {
  name: 'marketplace',
  run: async (ctx) => {
    const { users, subjects, now, log, academicYear } = ctx;
    const at = (daysAgo, hours = 0) => new Date(now.getTime() - daysAgo * DAY_MS + hours * HOUR_MS);
    const person = (key) => {
      const user = key === 'admin' ? users.admin : users.byEmail[`${key}@${DOMAIN}`];
      if (!user) throw new Error(`Unknown demo account "${key}"`);
      return user;
    };

    // 1. Previous demo data.
    const affected = await removePrevious(person);

    // 2. Documents with their generated PDF.
    const docs = {};
    for (const item of DOCUMENTS) {
      docs[item.key] = await createDocument(item, { person, subjects, academicYear, admin: users.admin, at });
    }

    // 3. Purchases (ledger entries of the buyer and the author) and free downloads.
    const acquired = new Set();
    for (const [key, buyerKey, daysAgo, downloaded] of PURCHASES) {
      await createAcquisition(docs[key], person(buyerKey), at(daysAgo), { paid: true, downloaded });
      acquired.add(`${key}|${buyerKey}`);
      affected.add(String(person(buyerKey)._id));
      affected.add(String(docs[key].author));
    }
    for (const [key, userKey, daysAgo] of FREE_DOWNLOADS) {
      await createAcquisition(docs[key], person(userKey), at(daysAgo), { paid: false, downloaded: true });
      acquired.add(`${key}|${userKey}`);
    }

    // 4. Reviews (only by users who bought or downloaded the document).
    for (const [key, userKey, rating, comment, daysAgo] of REVIEWS) {
      if (!acquired.has(`${key}|${userKey}`)) throw new Error(`Review of "${key}" by ${userKey} without acquisition`);
      const user = person(userKey);
      const date = at(daysAgo);
      await new MarketReview({
        document: docs[key]._id,
        author: user._id,
        authorSnapshot: { firstname: user.firstname, lastname: user.lastname },
        rating,
        comment,
        createdAt: date,
        updatedAt: date,
      }).save({ timestamps: false });
    }

    // 5. Counters of each document.
    await Promise.all(Object.values(docs).map(refreshCounters));

    // 6. Reports.
    for (const [key, reporterKey, reason, daysAgo, resolution] of REPORTS) {
      const date = at(daysAgo);
      const resolvedAt = resolution ? at(resolution.daysAgo) : null;
      await new MarketReport({
        document: docs[key]._id,
        reporter: person(reporterKey)._id,
        reason,
        status: resolution ? 'RESOLVED' : 'OPEN',
        outcome: resolution?.outcome ?? null,
        note: resolution?.note ?? null,
        resolvedAt,
        resolvedBy: resolution ? users.admin._id : null,
        createdAt: date,
        updatedAt: resolvedAt ?? date,
      }).save({ timestamps: false });
    }

    // 7. Wallets of the users involved, rebuilt from their ledger.
    for (const userId of affected) {
      if (!(await rebuildWallet(userId, at(31)))) log(`warning: negative ledger for user ${userId}, wallet set to 0`);
    }

    const published = DOCUMENTS.filter((item) => !item.status).length;
    log(
      `${DOCUMENTS.length} documents (${published} published, 1 pending review, 1 rejected), ${PURCHASES.length} purchases, ` +
        `${FREE_DOWNLOADS.length} free downloads, ${REVIEWS.length} reviews, ${REPORTS.length} reports, ${affected.size} wallets.`
    );
  },
};
