// Seed plugin of Module 7 (announcements), run by `npm run seed:demo` after the core data.
// Idempotent: the demo announcements (same author and title) are deleted with their reads and files,
// then created again. Sends no notification.
const Announcement = require('../../models/announcementModel');
const AnnouncementRead = require('../../models/announcementReadModel');
const audienceService = require('../../service/audienceService');
const storageService = require('../../service/storageService');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Multi-line plain text.
const text = (...lines) => lines.join('\n');

// Minimal one-page PDF (Helvetica, WinAnsi) with a few lines of text.
const buildPdf = (lines) => {
  const escapePdf = (value) => value.replace(/[\\()]/g, (char) => `\\${char}`);
  const content = [
    'BT',
    '/F1 20 Tf',
    '72 770 Td',
    '26 TL',
    ...lines.map((line, index) => `${index === 1 ? '/F1 12 Tf ' : ''}(${escapePdf(line)}) Tj T*`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

const run = async (ctx) => {
  const { users, groups, programs, now, time, log } = ctx;
  const admin = users.admin;
  const account = (name) => users.byEmail[`${name}@campuslink.local`] ?? null;
  const amira = account('amira.bensalah') ?? users.teachers[0];
  const leila = account('leila.gharbi') ?? users.teachers[2];

  // Groups a teacher teaches according to the suggested teaching plan (teacher restriction of the contract).
  const taughtBy = (user, names) => {
    const taught = new Set(
      ctx.teaching
        .filter((entry) => String(entry.teacher._id) === String(user._id))
        .flatMap((entry) => entry.groups.map((group) => group.name))
    );
    return names.filter((name) => taught.has(name)).map((name) => groups[name]._id);
  };

  const ago = (ms) => new Date(now.getTime() - ms);
  // In 3 days at 08:00 (campus timezone).
  const scheduledAt = time.parseLocalDateTime(time.addDaysToDateString(time.formatLocalDate(now), 3), '08:00');

  const audience = ({ roles = [], programs: programIds = [], levels = [], groups: groupIds = [] } = {}) => ({
    roles,
    programs: programIds,
    levels,
    groups: groupIds,
  });

  const items = [
    {
      key: 'closure',
      author: admin,
      title: 'Fermeture exceptionnelle du campus jeudi après-midi',
      body: text(
        'Bonjour à toutes et à tous,',
        '',
        'En raison de travaux sur le réseau électrique, le campus sera fermé jeudi à partir de 13 h.',
        'Les cours de l’après-midi sont reportés : ton emploi du temps sera mis à jour dans CampusLink.',
        '',
        'Merci de ta compréhension !'
      ),
      priority: 'URGENT',
      audience: audience(),
      status: 'PUBLISHED',
      publishedAt: ago(2 * HOUR_MS),
    },
    {
      key: 'exams',
      author: admin,
      title: 'Calendrier des examens du premier semestre',
      body: text(
        'Le calendrier des examens du premier semestre est disponible en pièce jointe.',
        '',
        'Vérifie bien tes dates et tes salles. En cas de chevauchement, contacte la scolarité avant vendredi.'
      ),
      priority: 'HIGH',
      audience: audience({ roles: ['STUDENT'], levels: [4] }),
      status: 'PUBLISHED',
      publishedAt: ago(1 * DAY_MS),
      attachment: {
        filename: 'calendrier-examens-S1.pdf',
        lines: [
          'Calendrier des examens - semestre 1',
          'Bases de donnees : lundi 12 janvier, 9 h, Amphi A',
          'Developpement web avance : mercredi 14 janvier, 9 h, A04',
          'Machine learning : jeudi 15 janvier, 14 h, C201',
        ],
      },
    },
    {
      key: 'bdd-project',
      author: amira,
      title: 'Bases de données : consignes du mini-projet',
      body: text(
        'Bonjour,',
        '',
        'Le mini-projet se fait en binôme. Rendu : un script SQL et un rapport de 5 pages maximum.',
        'Date limite : dans deux semaines, avant minuit.',
        '',
        'Bon courage !'
      ),
      priority: 'NORMAL',
      audience: audience({ roles: ['STUDENT'], groups: taughtBy(amira, ['4TWIN1', '4TWIN2']) }),
      status: 'PUBLISHED',
      publishedAt: ago(3 * DAY_MS),
    },
    {
      key: 'ml-lab',
      author: leila,
      title: 'Machine learning lab: bring your laptop',
      body: text(
        'Hi everyone,',
        '',
        'Next lab session is hands-on: please bring your laptop with Python 3.12 and Jupyter installed.',
        'See you in C201!'
      ),
      priority: 'LOW',
      audience: audience({ roles: ['STUDENT'], groups: taughtBy(leila, ['4DS1']) }),
      status: 'PUBLISHED',
      publishedAt: ago(5 * DAY_MS),
    },
    {
      key: 'teachers-meeting',
      author: admin,
      title: 'Réunion pédagogique de mi-semestre',
      body: text(
        'La réunion pédagogique de mi-semestre aura lieu mardi à 14 h en salle A12.',
        'Ordre du jour : bilan des projets et organisation des examens.'
      ),
      priority: 'NORMAL',
      audience: audience({ roles: ['TEACHER'] }),
      status: 'PUBLISHED',
      publishedAt: ago(2 * DAY_MS),
    },
    {
      key: 'hackathon',
      author: admin,
      title: 'Hackathon TWIN : les inscriptions sont ouvertes',
      body: text(
        'Le hackathon TWIN revient ce semestre ! Forme ton équipe (3 à 5 personnes) et inscris-toi auprès du club.',
        '24 h de code, des mentors et des prix à gagner.'
      ),
      priority: 'NORMAL',
      audience: audience({ programs: [programs.TWIN._id] }),
      status: 'PUBLISHED',
      publishedAt: ago(6 * DAY_MS),
    },
    {
      key: 'open-day',
      author: admin,
      title: 'Journée portes ouvertes',
      body: text(
        'La journée portes ouvertes aura lieu samedi.',
        'Tu peux te porter volontaire pour présenter ta filière aux visiteurs.'
      ),
      priority: 'HIGH',
      audience: audience(),
      status: 'SCHEDULED',
      publishAt: scheduledAt,
    },
    {
      key: 'survey-draft',
      author: admin,
      title: 'Enquête de satisfaction (brouillon)',
      body: 'Aide-nous à améliorer la vie sur le campus en répondant à notre enquête (10 minutes).',
      priority: 'LOW',
      audience: audience({ roles: ['STUDENT', 'ALUMNI'] }),
      status: 'DRAFT',
    },
  ];

  // Remove what a previous run created (same author and title), with reads and files.
  const previous = await Announcement.find({
    $or: items.map((item) => ({ author: item.author._id, title: item.title })),
  });
  for (const announcement of previous) {
    await AnnouncementRead.deleteMany({ announcement: announcement._id });
    for (const file of announcement.attachments) await storageService.remove(file.key).catch(() => {});
  }
  await Announcement.deleteMany({ _id: { $in: previous.map((announcement) => announcement._id) } });

  const created = {};
  for (const item of items) {
    const attachments = [];
    if (item.attachment) {
      const saved = await storageService.save({
        buffer: buildPdf(item.attachment.lines),
        originalName: item.attachment.filename,
        mimeType: 'application/pdf',
        folder: 'announcements',
      });
      attachments.push(saved);
    }
    const recipients =
      item.status === 'PUBLISHED' ? (await audienceService.resolveAudienceUserIds(item.audience)).length : 0;
    const createdAt = item.publishedAt ? new Date(item.publishedAt.getTime() - HOUR_MS) : ago(DAY_MS);

    const doc = new Announcement({
      title: item.title,
      body: item.body,
      priority: item.priority,
      audience: item.audience,
      attachments,
      author: item.author._id,
      authorSnapshot: { firstname: item.author.firstname, lastname: item.author.lastname, role: item.author.role },
      status: item.status,
      publishAt: item.publishAt ?? null,
      publishedAt: item.publishedAt ?? null,
      recipients,
      createdAt,
      updatedAt: item.publishedAt ?? createdAt,
    });
    await doc.save({ timestamps: false });
    created[item.key] = doc;
  }

  // A few reads, so the statistics are not empty.
  const reads = [
    ['closure', account('yasmine.haddad'), HOUR_MS],
    ['closure', account('omar.ferchichi'), 1.5 * HOUR_MS],
    ['exams', account('yasmine.haddad'), 2 * HOUR_MS],
    ['exams', account('ines.zouari'), 20 * HOUR_MS],
    ['bdd-project', account('yasmine.haddad'), 3 * HOUR_MS],
    ['bdd-project', account('ahmed.karray'), 1.2 * DAY_MS],
    ['bdd-project', account('nour.chaabane'), 2.1 * DAY_MS],
    ['ml-lab', account('youssef.hammami'), 4 * HOUR_MS],
    ['teachers-meeting', account('karim.trabelsi'), 5 * HOUR_MS],
  ].filter(([, user]) => Boolean(user));
  await AnnouncementRead.insertMany(
    reads.map(([key, user, delay]) => {
      const announcement = created[key];
      const readAt = new Date(Math.min(announcement.publishedAt.getTime() + delay, now.getTime()));
      return { announcement: announcement._id, user: user._id, readAt };
    })
  );

  const published = items.filter((item) => item.status === 'PUBLISHED').length;
  log(
    `${items.length} announcements (${published} published, 1 scheduled for ${scheduledAt.toISOString()}, 1 draft), ` +
      `${reads.length} reads.`
  );
};

module.exports = { name: 'announcements', run };
