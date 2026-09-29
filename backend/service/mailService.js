// const nodemailer = require('nodemailer');
const nodemailer = require('nodemailer');

const path = require('path');

require('dotenv').config();

const envoyerEmail = async ({ to, subject, html }) => {
  if (!to) return null;
  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'TUNISYS <no-reply@tunisys.tn>',
    to,
    subject,
    html,
  });
};

const envoyerEmailClientBloque = async ({ client, devisEnAttenteBC = [], seuil }) => {
  const recipients = buildClientRecipients(client?.emails);
  if (!recipients) {
    console.warn(`Aucune adresse email pour le client ${client?.nom || client?.code || ''}, email de blocage non envoyé.`);
    return false;
  }

  const subject = `Compte bloqué — devis en attente de bon de commande`;

  const lignesDevis = devisEnAttenteBC
    .map((d) => `<li>Devis <strong>${d.ref}</strong> (${d.type || ''})${d.montant ? ` — ${d.montant} DT` : ''}</li>`)
    .join('');

  const html = `
  <div style="font-family: Arial, sans-serif;">
    <p>Cher client,</p>
    <p>
      Nous vous informons que votre compte est actuellement <strong>bloqué</strong> pour la création
      de nouveaux devis, le nombre maximum de devis en cours autorisé (${seuil ?? ''}) étant atteint.
    </p>
    ${lignesDevis ? `
    <p>Les devis suivants sont en attente de votre <strong>bon de commande (BC)</strong> :</p>
    <ul>${lignesDevis}</ul>
    ` : `
    <p>Plusieurs devis restent en cours de traitement chez vous en attente du bon de commande.</p>
    `}
    <p>
      Merci de bien vouloir nous transmettre le(s) bon(s) de commande correspondant(s) dans les
      meilleurs délais afin de régulariser votre compte. Tant que ces devis restent en attente de BC,
      vous ne pourrez pas soumettre de nouvelle demande de devis.
    </p>
    <p><em>Comptant sur votre fidélité et votre confiance, veuillez agréer nos sincères salutations.</em></p>
    <br><br>
    <p>Help Desk</p>
    <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tunisys" />
    <p><small>Note : Ce mail est généré automatiquement, merci de ne pas y répondre.</small></p>
  </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: '"Tunisys TSS" <tunisys05@gmail.com>',
      to: recipients.to,
      cc: recipients.cc,
      subject,
      html,
      attachments: [
        {
          filename: 'logo.png',
          path: __dirname + '/../public/tu.png',
          cid: 'logo@ticket',
          contentDisposition: 'inline'
        }
      ],
    });
    console.log('Message sent (client bloqué): %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Erreur envoi email client bloqué:', error && error.stack ? error.stack : error);
    return false;
  }
};

// Email envoyé au client quand un devis est créé pour lui alors qu'il avait dépassé
// le seuil de devis en cours, grâce à une dérogation ("chance") accordée par un utilisateur.
const envoyerEmailDepassementSeuil = async ({ clientEmail, clientNom, seuil, devisRef }) => {
  return envoyerEmail({
    to: clientEmail,
    subject: 'Information concernant vos devis en cours',
    html: `
            <p>Bonjour ${clientNom || ''},</p>
            <p>
                Nous vous informons que vous aviez dépassé le nombre maximum de devis en cours
                autorisé (${seuil}). À titre exceptionnel, une dérogation vous a été accordée
                et un nouveau devis ${devisRef ? `(réf. ${devisRef}) ` : ''}a été créé pour vous.
            </p>
            <p>
                Nous vous invitons à finaliser vos devis en cours afin de faciliter le traitement
                de vos prochaines demandes.
            </p>
            
        `,
  });
};

// ─── Construit {to, cc} à partir des adresses email du client ───────────────
// - to  : la 1ère adresse du client
// - cc  : les autres adresses du client + l'adresse de l'émetteur (pour rappel/suivi)
// const buildClientRecipients = (adresses, emailEmetteur = process.env.MAIL_USER) => {
//   const adresses = Array.isArray(client?.adresses)
//     ? client.adresses.map((a) => (a || '').trim()).filter(Boolean)
//     : [];

//   if (adresses.length === 0) return null;

//   const to = adresses[0];
//   const ccSet = new Set(adresses.slice(1));
//   if (emailEmetteur) ccSet.add(emailEmetteur);
//   ccSet.delete(to);

//   const cc = Array.from(ccSet);
//   return { to, cc: cc.length ? cc.join(', ') : undefined };
// };
const buildClientRecipients = (adresses, emailEmetteur = process.env.MAIL_USER) => {
  const emails = Array.isArray(adresses)
    ? adresses.map(a => (a || '').trim()).filter(Boolean)
    : [];

  if (emails.length === 0) return null;

  const to = emails[0];

  const cc = [...new Set([
    ...emails.slice(1),
    emailEmetteur,
  ])]
    .filter(Boolean)
    .filter(email => email !== to);

  return {
    to,
    cc: cc.length ? cc : undefined, // Nodemailer accepte directement un tableau
  };
};
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'tunisys05@gmail.com',

  },
  port: 587,
  secure: false,
  connectionTimeout: 10000,
});
const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
const envoyerEmailChanceAccordee = async ({ client, devisRef, motif }) => {
  const recipients = buildClientRecipients(client?.emails);

  if (!recipients) {
    console.warn(
      `Aucune adresse email pour le client ${client?.name || client?.code || ''}, email de chance non envoyé.`
    );
    return false;
  }

  return envoyerEmail({
    to: recipients.to,
    subject: 'Information concernant vos devis en cours',
    html: `
      <div style="font-family: Arial, sans-serif;">
        <p>Bonjour ${escapeHtml(client?.name || '')},</p>

        <p>
          Vous aviez atteint le nombre maximum de devis en cours autorisé.
          À titre exceptionnel, une dérogation vous a été accordée et un nouveau devis
          ${devisRef ? `(réf. <strong>${escapeHtml(devisRef)}</strong>) ` : ''}
          a été créé pour vous.
        </p>

        ${motif
        ? `<p><strong>Motif :</strong> ${escapeHtml(motif)}</p>`
        : ''
      }

        <p>
          Nous vous invitons à finaliser vos devis en cours afin de faciliter
          le traitement de vos prochaines demandes.
        </p>

       

        <br>

        <p>Tunisys</p>
       <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tuniys" />

        <p>
          <small>
            Note : Ce mail est généré automatiquement, merci de ne pas y répondre.
          </small>
        </p>
      </div>
    `,
  });
};
const sendEmail = async (to, subject, html, imageBase64) => {
  try {
    const info = await transporter.sendMail({
      from: '"Tunisys TSS" <tunisys05@gmail.com>',
      to,
      subject,
      html,
      attachments: [
        {
          filename: 'logo.png',
          path: __dirname + '/../public/tu.png',
          cid: 'logo@ticket',
          contentDisposition: 'inline'
        }
      ]
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email: ', error && error.stack ? error.stack : error);
    return false;
  }
};

const sendEmailWithAttachments = async (to, subject, html, attachments) => {
  try {
    const extra = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
    const info = await transporter.sendMail({
      from: '"Tunisys TSS" <tunisys05@gmail.com>',
      to,
      subject,
      html,
      attachments: [
        {
          filename: 'logo.png',
          path: __dirname + '/../public/tu.png',
          cid: 'logo@ticket',
          contentDisposition: 'inline'
        },
        ...extra
      ]
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email: ', error && error.stack ? error.stack : error);
    return false;
  }
};


const ticketEmailTemplateEnglish = (client, reference, agence, numeroSerie, modele, createdAtFormatted, note) => {
  const subjectAnglais = `TSS Ticket #${reference} #${client} #${agence} #Opened`;

  // HTML version
  const htmlAnglais = `
  <div style="font-family: Arial, sans-serif;">
    <p>Dear Customer,</p>
    <p>Your request has been successfully received and is currently being processed. We will get back to you as soon as possible.</p>
    <p><strong>Ticket:</strong> ${reference}</p>
    <p><strong>Branch:</strong> ${agence}</p>
    <p><strong>Serial Number:</strong> ${numeroSerie}</p>
        <p><strong> Model:</strong> ${modele}</p>

    <p><strong>Created On:</strong> ${createdAtFormatted}</p>
    <p><strong>Submitted Issue:</strong> ${note}</p>
    <p>Thank you for your trust. We will keep you informed of any updates regarding this ticket.</p>
    <br><br>
    <p>Help Desk</p>
    <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tuniys " />

    <p><small>Note: This email was automatically generated, please do not reply.</small></p>
  </div>
  `;

  return { subjectAnglais, htmlAnglais };
}

const ticketEmailTemplate = (client, reference, agence, numeroSerie, modele, createdAtFormatted, note) => {
  const subject = `TSS Ticket #${reference} #${client} #${agence} #Ouvert`;


  // HTML version
  const html = `
  <div style="font-family: Arial, sans-serif;">
    <p>Cher client,</p>
    <p>Votre demande a bien été enregistrée et en cours de traitement. Nous reviendrons vers vous dans les plus brefs délais.</p>
    <p><strong>Ticket :</strong> ${reference}</p>
    <p><strong>Agence :</strong> ${agence}</p>
    <p><strong>Numéro de série :</strong> ${numeroSerie}</p>
            <p><strong>Modéle :</strong> ${modele}</p>

    <p><strong>Créé le :</strong> ${createdAtFormatted}</p>
    <p><strong>Réclamation reçue :</strong> ${note}</p>
    <p>Nous vous remercions de votre confiance et vous tiendrons informé de toute évolution concernant ce ticket.</p>
    <br><br>
    <p>Help Desk</p>
	 <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tuniys" />

    <p><small>Note : Ce mail est généré automatiquement, merci de ne pas y répondre.</small></p>
  </div>
  `;
  return { subject, html };
}

const ticketEmailTemplateCloture = (client, reference, agence, numeroSerie, modele, createdAtFormatted, closuretime, note, solution, mauvaise_qualite


) => {
  const subject = `TSS Ticket  #${reference} #${client} #${agence} #Cloturé`;

  // // Ajout conditionnel de la phrase pour mauvaise qualité
  const mauvaiseQualitePhrase = mauvaise_qualite
    ? `<p><strong>⚠️ Une mauvaise qualité des billets a été détectée.</strong></p>`
    : '';

  // // Vérifier si "Vandalisme" est présent dans solution (insensible à la casse)
  const vandalismePhrase = /vandalism/i.test(solution)
    ? `<p>S'agissant d'un acte de vandalisme, un devis de réparation vous sera établi le plus tôt possible.</p>
     <p>Nous resterons dans l'attente de votre approbation afin d'entamer les réparations dès que possible.</p>`
    : '';


  const html = `
  <div style="font-family: Arial, sans-serif;">
    <p>Cher client,</p>
    <p>Nous avons l'honneur de vous informer que la réclamation citée ci-dessous a été traitée.</p>
    <p><strong>Ticket :</strong> ${reference}</p>
    <p><strong>Agence :</strong> ${agence}</p>
    <p><strong>Numéro de série :</strong> ${numeroSerie}</p>
    <p><strong>Modéle :</strong> ${modele}</p>
    <p><strong>Créé le :</strong> ${createdAtFormatted}</p>
	    <p><strong>Cloturé le :</strong> ${closuretime}</p>

    <p><strong>Réclamation reçue :</strong> ${note}</p>
    <p><strong>Anomalie constatée :</strong> ${solution}</p>

	   ${vandalismePhrase}
	   ${mauvaiseQualitePhrase}
    <p><em>Comptant sur votre fidélité et votre confiance, Veuillez agréer vos sincères salutations.</em></p>
    <br><br>
    <p>Help Desk</p>
    <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tuniys" />

    <p><small>Note : Ce mail est généré automatiquement, merci de ne pas y répondre.</small></p>
  </div>
  `;

  return { subject, html };
};

const ticketEmailTemplateClosureEnglish = (client, reference, agence, numeroSerie, modele, createdAtFormatted, closuretime, note, solution, mauvaise_qualite) => {
  const subjectAnglais = `TSS Ticket #${reference}#${client} #${agence} #Closed`;
  // // Vérifier si "Vandalisme" est présent dans solution (insensible à la casse)
  const vandalismePhrase = /VANDALISM/i.test(solution)
    ? `<p>As this concerns an act of vandalism, a repair quote will be provided as soon as possible.</p>
<p>We will await your approval in order to begin the repairs as soon as possible.</p>`
    : '';

  // // Ajout conditionnel de la phrase pour mauvaise qualité
  const mauvaiseQualitePhrase = mauvaise_qualite
    ? `<p><strong>⚠️ BAD BANK NOTE QUALITY.</strong></p>`
    : '';
  // HTML version
  const htmlAnglais = `
  <div style="font-family: Arial, sans-serif;">
    <p>Dear Customer,</p>
    <p>We are pleased to inform you that the issue referenced below has been successfully resolved.</p>
    <p><strong>Ticket:</strong> ${reference}</p>
    <p><strong>Branch:</strong> ${agence}</p>
    <p><strong>Serial Number:</strong> ${numeroSerie}</p>
    <p><strong> Model:</strong> ${modele}</p>
    <p><strong>Opened on:</strong> ${createdAtFormatted}</p>
	    <p><strong>Closed on:</strong> ${closuretime}</p>

    <p><strong>Submitted Issue:</strong> ${note}</p>
	
    <p><strong>Diagnosed Issue:</strong> ${solution}</p>
	   ${vandalismePhrase}
	   ${mauvaiseQualitePhrase}
    <p><em>We sincerely thank you for your trust and continued loyalty.</em></p>
    <br><br>
    <p>Help Desk</p>
      <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tuniys" />

    <p><small>Note: This email was automatically generated. Please do not reply.</small></p>
  </div>
  `;

  return { subjectAnglais, htmlAnglais };
};

const sendOTPMail = (otp) => {
  const subject = `TSS OTP Code`;
  // HTML version
  const html = `
  <div style="font-family: Arial, sans-serif;">
    <p>Your OTP is ${otp}. It will expire in 10 minutes.</p>
    <br><br>
    <p>Help Desk</p>
    <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tuniys " />

    <p><small>Note: This email was automatically generated, please do not reply.</small></p>
  </div>
  `;

  return { subject, html };
}


const reportingTicketEmail = (client, reference, agence, numeroSerie, modele, createdAtFormatted, note, raisonReport) => {
  const subject = `TSS Ticket #${reference} #${client} #${agence} #Reporté`;

  const html = `
  <div style="font-family: Arial, sans-serif;">
    <p>Bonjour,</p>
    <p>Nous vous informons que l’intervention liée au ticket ci-dessous a été <strong>reportée</strong>.</p>
    <p><strong>Référence du ticket :</strong> ${reference}</p>
    <p><strong>Agence :</strong> ${agence}</p>
    <p><strong>Numéro de série :</strong> ${numeroSerie}</p>
    <p><strong>Modèle :</strong> ${modele}</p>
    <p><strong>Crée le :</strong> ${createdAtFormatted}</p>
    <p><strong>Reclamation reçue :</strong> ${note}</p>
    <p><strong>Raison Report :</strong> ${raisonReport}</p>
    <p><em>Nous vous remercions pour votre compréhension et restons à votre disposition.</em></p>
    <br><br>
    <p>Service Help Desk</p>
    <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tuniys" />
    <p><small>Note : Cet e-mail a été généré automatiquement. Merci de ne pas y répondre.</small></p>
  </div>
  `;

  return { subject, html };
};




const reportingTicketEmailEnglish = (client, reference, agence, numeroSerie, modele, createdAtFormatted, note, raisonReport) => {
  const subjectAnglais = `TSS Ticket #${reference} #${client} #${agence}#Reported`;

  const htmlAnglais = `
  <div style="font-family: Arial, sans-serif;">
    <p>Dear Customer,</p>
    <p>We would like to inform you that the intervention related to the ticket below has been <strong>reported</strong>.</p>
    <p><strong>Ticket Reference:</strong> ${reference}</p>
    <p><strong>Branch:</strong> ${agence}</p>
    <p><strong>Serial Number:</strong> ${numeroSerie}</p>
    <p><strong>Model:</strong> ${modele}</p>
    <p><strong>Created At:</strong> ${createdAtFormatted}</p>
    <p><strong>Submitted Issue:</strong> ${note}</p>
    <p><strong>Reporting Reason:</strong> ${raisonReport}</p>
    <p><em>We appreciate your understanding and remain at your disposal.</em></p>
    <br><br>
    <p>Help Desk</p>
    <img style="width:150px; height:100px" src="cid:logo@ticket" alt="Tuniys" />
    <p><small>Note: This email was automatically generated. Please do not reply.</small></p>
  </div>
  `;

  return { subjectAnglais, htmlAnglais };
};

const envoyerEmailDemandeDeblocage = async ({ client, token, nbDevisEnCours, seuil, managerEmails }) => {
  if (!managerEmails || managerEmails.length === 0) return false;

  const baseUrl = process.env.BACKEND_URL || 'http://172.16.0.35:4000';
  const lienAccepter = `${baseUrl}/api/chances/deblocage/${token}/accepter`;
  const lienRefuser = `${baseUrl}/api/chances/deblocage/${token}/refuser`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px">
      <h2>Demande déblocage client devis</h2>
      <p>
        Le client <strong>${client.name}</strong> (code ${client.code}) a atteint
        ${nbDevisEnCours}/${seuil} devis en cours et ne peut plus créer de nouveau devis.
      </p>
      <p>Veuillez débloquer ce client.</p>
      <div style="margin-top:20px">
        <a href="${lienAccepter}"
           style="background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;
                  text-decoration:none;font-weight:bold;margin-right:12px;">
          Accepter
        </a>
        <a href="${lienRefuser}"
           style="background:#dc2626;color:#fff;padding:10px 20px;border-radius:6px;
                  text-decoration:none;font-weight:bold;">
          Refuser
        </a>
      </div>
      <p style="margin-top:20px;color:#888;font-size:12px">
        Ce lien est à usage unique et n'est valable que pour cette demande.
      </p>
    </div>
  `;

  return envoyerEmail({
    to: managerEmails.join(','),
    subject: 'Demande déblocage client devis',
    html,
  });
}
module.exports = { envoyerEmailChanceAccordee, buildClientRecipients, envoyerEmailClientBloque, sendOTPMail, reportingTicketEmailEnglish, reportingTicketEmail, ticketEmailTemplateClosureEnglish, ticketEmailTemplateEnglish, sendEmail, sendEmailWithAttachments, ticketEmailTemplate, ticketEmailTemplateCloture, envoyerEmailDemandeDeblocage };

