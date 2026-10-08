// Seed plugin of Module 4 (help forum), run by `npm run seed:demo` after the core data.
// Questions in several subjects, answers (certified teacher answers, accepted answers, one hidden answer),
// votes, follows, reports, then the reputation profiles and badges of the demo users (recomputed from the data).
// Idempotent: the demo questions (same author and title) are deleted with everything attached, then created again.
// Sends no notification.
const ForumQuestion = require('../../models/forumQuestionModel');
const ForumAnswer = require('../../models/forumAnswerModel');
const ForumVote = require('../../models/forumVoteModel');
const ForumFollow = require('../../models/forumFollowModel');
const ForumView = require('../../models/forumViewModel');
const ForumReport = require('../../models/forumReportModel');
const ForumProfile = require('../../models/forumProfileModel');
const forumService = require('../../service/forumService');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Multi-line plain text.
const text = (...lines) => lines.join('\n');

/*
 * Demo content. `author`, `up`, `down`, `followers`, `reports[].by` are keys of the people map below.
 * `daysAgo`: question date; answers are posted `hours` after the question. One accepted answer per question at most.
 */
const QUESTIONS = [
  {
    key: 'joins',
    author: 'yasmine',
    subject: 'BDD',
    chapter: 'Requêtes SQL',
    level: 4,
    tags: ['sql', 'jointures'],
    daysAgo: 24,
    title: 'Quelle différence entre INNER JOIN et LEFT JOIN ?',
    body: text(
      'Je révise pour le contrôle de bases de données et je mélange toujours les deux.',
      '',
      'Avec INNER JOIN je perds certaines lignes de ma table clients, avec LEFT JOIN j’ai des NULL partout.',
      'Quand faut-il utiliser l’un ou l’autre ?'
    ),
    up: ['omar', 'sarra', 'ahmed', 'nour'],
    answers: [
      {
        author: 'amira',
        hours: 3,
        accepted: true,
        body: text(
          'INNER JOIN ne garde que les lignes qui ont une correspondance dans les deux tables.',
          'LEFT JOIN garde toutes les lignes de la table de gauche, et met NULL quand il n’y a pas de correspondance à droite.',
          '',
          'Exemple : SELECT c.nom, f.id FROM clients c LEFT JOIN factures f ON f.client_id = c.id;',
          'te donne aussi les clients sans facture (f.id vaut NULL). Pour les trouver : WHERE f.id IS NULL.'
        ),
        up: ['yasmine', 'omar', 'sarra', 'ahmed'],
      },
      {
        author: 'omar',
        hours: 5,
        body: 'Tip: draw the two tables as circles. INNER JOIN is the intersection, LEFT JOIN is the whole left circle.',
        up: ['sarra'],
      },
    ],
  },
  {
    key: 'having',
    author: 'ahmed',
    subject: 'BDD',
    chapter: 'Agrégation',
    level: 4,
    tags: ['sql', 'group-by'],
    daysAgo: 20,
    title: 'Comment filtrer des groupes avec GROUP BY et HAVING ?',
    body: text(
      'Je veux la liste des étudiants qui ont plus de 3 absences.',
      'Quand je mets COUNT(*) > 3 dans le WHERE, j’ai une erreur. Où est-ce que je me trompe ?'
    ),
    up: ['nour', 'yasmine'],
    answers: [
      {
        author: 'yasmine',
        hours: 1,
        body: 'Le WHERE filtre les lignes avant le regroupement, donc il ne connaît pas encore COUNT(*). Il faut HAVING.',
        up: ['ahmed'],
      },
      {
        author: 'amira',
        hours: 4,
        accepted: true,
        body: text(
          'Exactement : WHERE filtre les lignes, HAVING filtre les groupes.',
          '',
          'SELECT etudiant_id, COUNT(*) AS absences',
          'FROM presences WHERE statut = \'ABSENT\'',
          'GROUP BY etudiant_id',
          'HAVING COUNT(*) > 3;'
        ),
        up: ['ahmed', 'nour', 'yasmine'],
      },
    ],
  },
  {
    key: 'index',
    author: 'ines',
    subject: 'BDD',
    chapter: 'Index et performances',
    level: 4,
    tags: ['index', 'performance'],
    daysAgo: 17,
    status: 'CLOSED',
    title: 'Index composite : dans quel ordre mettre les colonnes ?',
    body: text(
      'Pour une requête WHERE groupe = ? AND date > ? ORDER BY date, je dois créer un index (groupe, date) ou (date, groupe) ?',
      'Le prof a dit que l’ordre compte mais je ne comprends pas pourquoi.'
    ),
    up: ['youssef', 'malek'],
    answers: [
      {
        author: 'amira',
        hours: 2,
        accepted: true,
        body: text(
          'Mets d’abord les colonnes testées par égalité, puis celles des intervalles et du tri : (groupe, date).',
          'L’index est trié par groupe puis par date : la base saute directement au bon groupe, lit les dates dans l’ordre,',
          'et n’a même pas besoin de trier pour le ORDER BY.'
        ),
        up: ['ines', 'youssef', 'malek'],
      },
      {
        author: 'youssef',
        hours: 6,
        body: 'Tu peux vérifier avec EXPLAIN : avec (groupe, date) tu dois voir un "Index Scan" sans étape de tri.',
        up: ['ines'],
      },
      {
        author: 'yasmine',
        hours: 9,
        body: 'Merci, j’avais la même question pour mon projet, ça m’aide aussi !',
      },
    ],
  },
  {
    key: 'normalization',
    author: 'nour',
    subject: 'BDD',
    chapter: 'Modélisation',
    level: 4,
    tags: ['normalisation', 'modelisation'],
    daysAgo: 14,
    title: 'Normalisation : faut-il toujours aller jusqu’à la 3FN ?',
    body: text(
      'Dans notre mini-projet, la 3FN nous oblige à créer beaucoup de tables et les requêtes deviennent longues.',
      'Est-ce que c’est grave de rester en 2FN pour certaines tables ?'
    ),
    up: ['ahmed'],
    answers: [
      {
        author: 'amira',
        hours: 5,
        accepted: true,
        body: text(
          'Vise la 3FN par défaut : elle évite les anomalies de mise à jour.',
          'Tu peux dénormaliser ensuite, en connaissance de cause, pour une requête très fréquente (et le justifier dans ton rapport).'
        ),
        up: ['nour', 'ahmed'],
      },
      {
        author: 'yasmine',
        hours: 7,
        body: 'On a eu le même souci : des vues SQL nous ont permis de garder des requêtes courtes avec un schéma en 3FN.',
        up: ['nour'],
      },
    ],
  },
  {
    key: 'isolation',
    author: 'sarra',
    subject: 'BDD',
    chapter: 'Transactions',
    level: 4,
    tags: ['transactions', 'sql'],
    daysAgo: 11,
    title: 'Transactions : à quoi sert le niveau d’isolation READ COMMITTED ?',
    body: text(
      'Je ne vois pas la différence entre READ COMMITTED et REPEATABLE READ.',
      'Tu aurais un exemple concret de problème que chacun évite ?'
    ),
    up: ['yasmine', 'omar'],
    answers: [
      {
        author: 'amira',
        hours: 3,
        accepted: true,
        body: text(
          'READ COMMITTED : tu ne lis jamais de données non validées, mais deux lectures dans la même transaction',
          'peuvent donner des résultats différents si quelqu’un a validé entre-temps (lecture non répétable).',
          'REPEATABLE READ garantit que tu relis les mêmes valeurs pendant toute ta transaction.'
        ),
        up: ['sarra', 'yasmine'],
      },
      {
        author: 'ahmed',
        hours: 8,
        body: 'Pour tester : ouvre deux terminaux psql et fais un UPDATE dans l’un pendant que l’autre relit la ligne.',
        up: ['sarra'],
      },
    ],
  },
  {
    key: 'mongo-postgres',
    author: 'malek',
    subject: 'BDD',
    level: 4,
    tags: ['mongodb', 'postgresql'],
    daysAgo: 6,
    title: 'MongoDB ou PostgreSQL pour un projet de fin d’études ?',
    body: text(
      'Notre application gère des étudiants, des groupes et des notes.',
      'On hésite entre MongoDB et PostgreSQL. Quels critères regarder pour choisir ?'
    ),
    up: ['ines', 'youssef'],
    followers: ['ines', 'youssef'],
    answers: [
      {
        author: 'youssef',
        hours: 2,
        body: 'Vos données sont très relationnelles (étudiants ↔ groupes ↔ notes) : PostgreSQL me semble plus naturel.',
        up: ['malek'],
      },
      {
        author: 'yasmine',
        hours: 4,
        body: 'MongoDB est pratique si vos documents changent souvent de forme. Sinon les contraintes de PostgreSQL aident beaucoup.',
      },
      {
        author: 'hamza',
        hours: 6,
        body: 'Demande à une IA de faire le projet à ta place, c’est plus rapide que de réfléchir.',
        hidden: { reason: 'Réponse hors sujet, qui n’aide pas à apprendre.' },
        reports: [{ by: 'ines', reason: 'Réponse irrespectueuse et inutile.', resolved: true }],
      },
    ],
  },
  {
    key: 'jwt',
    author: 'omar',
    subject: 'WEB',
    chapter: 'Authentication',
    level: 4,
    tags: ['express', 'jwt', 'security'],
    daysAgo: 22,
    title: 'How do I protect my Express API with JWT refresh tokens?',
    body: text(
      'My access token expires after 15 minutes and users get logged out.',
      'Where should I store the refresh token, and how do I rotate it safely?'
    ),
    up: ['rami', 'yasmine', 'ahmed'],
    answers: [
      {
        author: 'karim',
        hours: 2,
        accepted: true,
        body: text(
          'Keep the access token short-lived and send the refresh token in an httpOnly, Secure cookie (web) or secure storage (mobile).',
          'Store only a hash of the refresh token in the database, make it single-use and issue a new one on every refresh.',
          'If an old token is reused, revoke the whole session.'
        ),
        up: ['omar', 'rami', 'yasmine'],
      },
      {
        author: 'yasmine',
        hours: 5,
        body: 'Ne mets jamais le refresh token dans le localStorage : un script injecté pourrait le lire.',
        up: ['omar'],
      },
    ],
  },
  {
    key: 'server-components',
    author: 'rami',
    subject: 'WEB',
    chapter: 'Next.js',
    level: 4,
    tags: ['nextjs', 'react'],
    daysAgo: 13,
    title: 'Next.js: when should I use Server Components vs Client Components?',
    body: text(
      'Everything works when I add "use client" everywhere, but my teacher says it is a bad habit.',
      'What is the rule of thumb?'
    ),
    up: ['omar', 'nour'],
    answers: [
      {
        author: 'karim',
        hours: 4,
        accepted: true,
        body: text(
          'Server Components by default: they fetch data on the server and ship no JavaScript.',
          'Use a Client Component only for interactivity (state, effects, event handlers, browser APIs), as low as possible in the tree.'
        ),
        up: ['rami', 'nour', 'ahmed'],
      },
      {
        author: 'yasmine',
        hours: 6,
        body: 'Astuce : garde ta page en Server Component et isole juste le bouton ou le formulaire dans un petit Client Component.',
        up: ['rami'],
      },
    ],
  },
  {
    key: 'cors',
    author: 'yasmine',
    subject: 'WEB',
    chapter: 'HTTP',
    level: 4,
    tags: ['cors', 'fetch'],
    daysAgo: 9,
    title: 'Pourquoi mon fetch renvoie une erreur CORS en local ?',
    body: text(
      'Mon front tourne sur le port 3000 et mon API sur le port 4000.',
      'Le navigateur bloque la requête avec "No Access-Control-Allow-Origin header". Pourtant Postman marche !'
    ),
    up: ['sarra', 'omar'],
    answers: [
      {
        author: 'ahmed',
        hours: 1,
        accepted: true,
        body: text(
          'Postman n’applique pas CORS, seul le navigateur le fait.',
          'Côté Express : app.use(cors({ origin: \'http://localhost:3000\' })) avant tes routes.'
        ),
        up: ['yasmine', 'sarra'],
      },
      {
        author: 'karim',
        hours: 3,
        body: 'Et en production, mieux vaut passer par un proxy (même origine) plutôt que d’ouvrir CORS à tout le monde.',
        up: ['yasmine'],
      },
    ],
  },
  {
    key: 'overfitting',
    author: 'youssef',
    subject: 'ML',
    chapter: 'Régularisation',
    level: 4,
    tags: ['overfitting', 'regularisation'],
    daysAgo: 16,
    title: 'Surapprentissage : comment choisir entre L1 et L2 ?',
    body: text(
      'Mon modèle a 99 % de précision sur le jeu d’entraînement et 70 % sur le jeu de test.',
      'Je pense que c’est du surapprentissage. Quelle régularisation essayer en premier ?'
    ),
    up: ['ines', 'malek'],
    answers: [
      {
        author: 'leila',
        hours: 3,
        accepted: true,
        body: text(
          'Yes, that gap is classic overfitting. Start with L2 (ridge): it shrinks all weights smoothly.',
          'Use L1 (lasso) when you suspect many useless features: it pushes some weights to exactly zero.',
          'Tune the strength with cross-validation, never on the test set.'
        ),
        up: ['youssef', 'ines', 'malek'],
      },
      {
        author: 'ines',
        hours: 7,
        body: 'Pense aussi à ajouter des données ou à simplifier le modèle avant de jouer avec la régularisation.',
        up: ['youssef'],
      },
    ],
  },
  {
    key: 'precision-recall',
    author: 'lina',
    subject: 'ML',
    chapter: 'Evaluation',
    level: 4,
    tags: ['metrics'],
    daysAgo: 4,
    title: 'What is the difference between precision and recall?',
    body: text(
      'For a spam detector, which one matters most?',
      'I always confuse the two formulas.'
    ),
    up: ['malek'],
    answers: [
      {
        author: 'leila',
        hours: 2,
        body: text(
          'Precision: among the emails flagged as spam, how many really are spam. Recall: among the real spam, how many you caught.',
          'For spam, precision usually matters most: losing a real email is worse than letting one spam through.'
        ),
        up: ['lina', 'malek'],
      },
      {
        author: 'malek',
        hours: 5,
        body: 'Moyen mnémotechnique : la précision regarde ce que tu as prédit, le rappel regarde ce qui existe vraiment.',
      },
      {
        author: 'yasmine',
        hours: 8,
        body: 'Le F1-score combine les deux si tu veux un seul chiffre pour comparer tes modèles.',
      },
    ],
  },
  {
    key: 'microservices',
    author: 'aya',
    subject: 'ARCH',
    chapter: 'Microservices',
    level: 4,
    tags: ['microservices', 'architecture'],
    daysAgo: 12,
    title: 'Microservices : comment partager des données entre services ?',
    body: text(
      'Dans notre projet, le service commandes a besoin des informations du service clients.',
      'Est-ce qu’on peut partager la même base de données entre les deux ?'
    ),
    up: ['hamza', 'lina'],
    answers: [
      {
        author: 'mehdi',
        hours: 4,
        accepted: true,
        body: text(
          'Évite la base partagée : chaque service doit rester maître de ses données.',
          'Expose une API (ou publie des événements) et garde dans le service commandes une copie des quelques champs clients utiles.'
        ),
        up: ['aya', 'hamza', 'lina'],
      },
      {
        author: 'hamza',
        hours: 6,
        body: 'On a utilisé RabbitMQ pour ça au dernier projet : un événement "client.modifié" met à jour la copie locale.',
        up: ['aya'],
      },
      {
        author: 'yasmine',
        hours: 9,
        body: 'Attention à la cohérence : la copie peut être en retard de quelques secondes, il faut l’accepter dans le design.',
      },
    ],
  },
  {
    key: 'planning-poker',
    author: 'hamza',
    subject: 'AGILE',
    chapter: 'Scrum',
    level: 4,
    tags: ['scrum', 'estimation'],
    daysAgo: 8,
    title: 'Comment bien estimer les user stories au planning poker ?',
    body: text(
      'Dans notre équipe, les estimations varient de 2 à 13 points pour la même story.',
      'Comment converger sans y passer toute la réunion ?'
    ),
    up: ['aya', 'ines'],
    answers: [
      {
        author: 'mehdi',
        hours: 3,
        body: 'Fais expliquer leur choix aux personnes qui ont donné la plus petite et la plus grande valeur, puis revotez une fois.',
        up: ['hamza'],
      },
      {
        author: 'yasmine',
        hours: 5,
        accepted: true,
        body: text(
          'Ce qui nous a aidés : choisir une story de référence à 3 points et comparer chaque nouvelle story à celle-là.',
          'Si on n’est toujours pas d’accord après deux tours, on découpe la story.'
        ),
        up: ['hamza', 'aya', 'ines'],
      },
      {
        author: 'selim',
        hours: 30,
        body: 'En entreprise on fait pareil, et on limite chaque discussion à 5 minutes avec un minuteur.',
        up: ['hamza'],
      },
    ],
  },
  {
    key: 'english-oral',
    author: 'sarra',
    subject: 'ENG',
    level: 4,
    tags: ['oral', 'presentation'],
    daysAgo: 3,
    title: 'Conseils pour préparer l’oral d’anglais professionnel ?',
    body: text(
      'J’ai une présentation de 10 minutes sur mon stage et je stresse beaucoup.',
      'Comment m’entraîner efficacement ?'
    ),
    up: ['nour'],
    followers: ['nour'],
    answers: [
      {
        author: 'leila',
        hours: 5,
        body: text(
          'Rehearse out loud three times, and record yourself once: you will spot filler words quickly.',
          'Prepare your first and last sentences by heart, keep the rest as bullet points.'
        ),
        up: ['sarra', 'nour'],
      },
      {
        author: 'yasmine',
        hours: 7,
        body: 'Entraîne-toi devant un ami qui te pose deux ou trois questions à la fin, c’est souvent ce qui stresse le plus.',
        up: ['sarra'],
      },
    ],
  },
  {
    key: 'strategy',
    author: 'skander',
    subject: 'ARCH',
    chapter: 'Design patterns',
    level: 4,
    tags: ['design-patterns'],
    daysAgo: 1,
    title: 'Design patterns : quand utiliser le pattern Strategy ?',
    body: text(
      'J’ai un calcul de prix différent selon le type de client et mon code est rempli de if/else.',
      'Est-ce que Strategy est adapté ici ?'
    ),
    followers: ['aya'],
    answers: [],
  },
  {
    key: 'spam',
    author: 'rami',
    subject: 'WEB',
    level: null,
    tags: [],
    daysAgo: 2,
    title: 'Vends calculatrice graphique presque neuve, prix étudiant',
    body: 'Calculatrice graphique en très bon état, à vendre. Écris-moi en message privé si tu es intéressé.',
    reports: [
      { by: 'ahmed', reason: 'Annonce de vente, ce n’est pas une question sur un cours.' },
      { by: 'sarra', reason: 'Hors sujet pour le forum d’entraide.' },
    ],
    answers: [],
  },
];

const PEOPLE = {
  admin: null, // ctx.users.admin
  amira: 'amira.bensalah',
  karim: 'karim.trabelsi',
  leila: 'leila.gharbi',
  mehdi: 'mehdi.jaziri',
  yasmine: 'yasmine.haddad',
  omar: 'omar.ferchichi',
  sarra: 'sarra.mansouri',
  ahmed: 'ahmed.karray',
  nour: 'nour.chaabane',
  rami: 'rami.belhaj',
  ines: 'ines.zouari',
  youssef: 'youssef.hammami',
  malek: 'malek.ayari',
  aya: 'aya.khelifi',
  hamza: 'hamza.dridi',
  lina: 'lina.bouazizi',
  skander: 'skander.mejri',
  selim: 'selim.rekik',
};

const run = async (ctx) => {
  const { users, subjects, now, log } = ctx;

  const people = {};
  Object.entries(PEOPLE).forEach(([key, email]) => {
    people[key] = email ? users.byEmail[`${email}@campuslink.local`] ?? null : users.admin;
  });
  const missing = Object.entries(people)
    .filter(([, user]) => !user)
    .map(([key]) => key);
  if (missing.length > 0) throw new Error(`Missing demo accounts: ${missing.join(', ')}`);
  const at = (date) => new Date(Math.min(date.getTime(), now.getTime() - 60 * 1000));

  // Remove what a previous run created (same author and title), with everything attached.
  const previous = await ForumQuestion.find({
    $or: QUESTIONS.map((item) => ({ author: people[item.author]._id, title: item.title })),
  })
    .select('_id')
    .lean();
  const previousIds = previous.map((question) => question._id);
  const previousAnswerIds = await ForumAnswer.distinct('_id', { question: { $in: previousIds } });
  await Promise.all([
    ForumVote.deleteMany({
      $or: [
        { targetType: 'QUESTION', target: { $in: previousIds } },
        { targetType: 'ANSWER', target: { $in: previousAnswerIds } },
      ],
    }),
    ForumReport.deleteMany({ question: { $in: previousIds } }),
    ForumFollow.deleteMany({ question: { $in: previousIds } }),
    ForumView.deleteMany({ question: { $in: previousIds } }),
    ForumAnswer.deleteMany({ question: { $in: previousIds } }),
  ]);
  await ForumQuestion.deleteMany({ _id: { $in: previousIds } });

  const snapshot = (user) => ({ firstname: user.firstname, lastname: user.lastname, role: user.role });
  const counts = { questions: 0, answers: 0, certified: 0, accepted: 0, votes: 0, reports: 0, follows: 0 };

  // Votes of `up` / `down` lists on a target (never on one's own content).
  const castVotes = async ({ targetType, target, author, subject, item, createdAt }) => {
    let score = 0;
    const entries = [...(item.up ?? []).map((key) => [key, 1]), ...(item.down ?? []).map((key) => [key, -1])];
    for (const [index, [key, value]] of entries.entries()) {
      const voter = people[key];
      if (String(voter._id) === String(author._id)) continue;
      const date = at(new Date(createdAt.getTime() + (index + 1) * 2 * HOUR_MS));
      await new ForumVote({
        user: voter._id,
        targetType,
        target,
        targetAuthor: author._id,
        subject,
        value,
        createdAt: date,
        updatedAt: date,
      }).save({ timestamps: false });
      score += value;
      counts.votes += 1;
    }
    return score;
  };

  for (const item of QUESTIONS) {
    const author = people[item.author];
    const subject = subjects[item.subject];
    if (!subject) throw new Error(`Unknown subject ${item.subject}`);
    const createdAt = at(new Date(now.getTime() - item.daysAgo * DAY_MS));

    const question = new ForumQuestion({
      title: item.title,
      body: item.body,
      subject: subject._id,
      chapter: item.chapter ?? null,
      level: item.level ?? null,
      tags: item.tags ?? [],
      author: author._id,
      authorSnapshot: snapshot(author),
      status: item.status ?? 'OPEN',
      createdAt,
      updatedAt: createdAt,
      lastActivityAt: createdAt,
    });
    question.score = await castVotes({
      targetType: 'QUESTION',
      target: question._id,
      author,
      subject: subject._id,
      item,
      createdAt,
    });

    let lastActivityAt = createdAt;
    let visibleAnswers = 0;
    let certified = false;
    for (const answerItem of item.answers) {
      const answerAuthor = people[answerItem.author];
      const answeredAt = at(new Date(createdAt.getTime() + answerItem.hours * HOUR_MS));
      const hidden = Boolean(answerItem.hidden);
      const answer = new ForumAnswer({
        question: question._id,
        subject: subject._id,
        body: answerItem.body,
        author: answerAuthor._id,
        authorSnapshot: snapshot(answerAuthor),
        certified: answerAuthor.role === 'TEACHER',
        hidden,
        hiddenAt: hidden ? at(new Date(answeredAt.getTime() + 2 * HOUR_MS)) : null,
        hiddenBy: hidden ? people.admin._id : null,
        hiddenReason: hidden ? answerItem.hidden.reason : null,
        createdAt: answeredAt,
        updatedAt: answeredAt,
      });
      answer.score = await castVotes({
        targetType: 'ANSWER',
        target: answer._id,
        author: answerAuthor,
        subject: subject._id,
        item: answerItem,
        createdAt: answeredAt,
      });
      await answer.save({ timestamps: false });
      counts.answers += 1;

      if (!hidden) {
        visibleAnswers += 1;
        if (answer.certified) certified = true;
      }
      if (answer.certified) counts.certified += 1;
      if (answeredAt > lastActivityAt) lastActivityAt = answeredAt;
      if (answerItem.accepted) {
        question.acceptedAnswer = answer._id;
        question.acceptedAt = at(new Date(answeredAt.getTime() + 2 * HOUR_MS));
        if (question.acceptedAt > lastActivityAt) lastActivityAt = question.acceptedAt;
        counts.accepted += 1;
      }

      for (const report of answerItem.reports ?? []) {
        await ForumReport.create({
          targetType: 'ANSWER',
          target: answer._id,
          question: question._id,
          reporter: people[report.by]._id,
          reason: report.reason,
          ...(report.resolved
            ? {
                status: 'RESOLVED',
                outcome: hidden ? 'HIDDEN' : 'NO_ACTION',
                resolvedAt: answer.hiddenAt ?? answeredAt,
                resolvedBy: people.admin._id,
              }
            : {}),
        });
        counts.reports += 1;
      }
    }

    question.answerCount = visibleAnswers;
    question.answersTotal = item.answers.length;
    question.hasCertifiedAnswer = certified;
    question.lastActivityAt = lastActivityAt;
    question.viewCount = 6 + item.answers.length * 7 + (item.up ?? []).length * 3;
    await question.save({ timestamps: false });
    counts.questions += 1;

    // The author follows the question, plus the listed followers.
    const followers = [...new Set([item.author, ...(item.followers ?? [])])];
    for (const key of followers) {
      await ForumFollow.create({ question: question._id, user: people[key]._id, createdAt });
      counts.follows += 1;
    }

    for (const report of item.reports ?? []) {
      await ForumReport.create({
        targetType: 'QUESTION',
        target: question._id,
        question: question._id,
        reporter: people[report.by]._id,
        reason: report.reason,
      });
      counts.reports += 1;
    }
  }

  // Profiles: recomputed from the data (same rules as the API), badges awarded again without notifications.
  const demoUsers = [...new Map(Object.values(people).map((user) => [String(user._id), user])).values()];
  await ForumProfile.updateMany({ user: { $in: demoUsers.map((user) => user._id) } }, { $set: { badges: [] } });
  let badges = 0;
  for (const user of demoUsers) {
    await forumService.recomputeProfile(user._id);
    badges += (await forumService.awardBadges(user._id, { notify: false, awardedAt: now })).length;
  }

  log(
    `${counts.questions} questions, ${counts.answers} answers (${counts.certified} certified, ${counts.accepted} accepted, ` +
      `1 hidden), ${counts.votes} votes, ${counts.follows} follows, ${counts.reports} reports, ${badges} badges.`
  );
};

module.exports = { name: 'forum', run };
