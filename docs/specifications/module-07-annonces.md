# Module 7 — Notifications et annonces administratives

**Objectif** : donner à l'administration (et aux enseignants pour leurs groupes) un canal de diffusion ciblé,
fiable et mesurable. **Acteurs** : administration, scolarité, enseignant, étudiant, alumni.

## Règles de gestion

- Une annonce a un titre (200 caractères max), un message en texte simple (10 000 max), une priorité
  (urgente, importante, normale, faible) et jusqu'à 5 pièces jointes de 10 Mo (PDF, images, Word, Excel,
  PowerPoint, texte).
- **Audience** : rôles, filières, niveaux et groupes ; chaque critère réduit le public ; rien de coché = tout le
  monde. Les critères filière, niveau et groupe ne concernent que les utilisateurs qui ont un groupe.
- Un **enseignant** ne peut cibler que des groupes où il enseigne cette année (et seulement des étudiants).
- Statuts : brouillon, programmée (au moins 1 minute plus tard), publiée. Une annonce publiée garde son audience
  et ses fichiers ; seuls le titre, le message et la priorité restent modifiables.
- À la publication, chaque destinataire reçoit une notification in-app et push dans sa langue ; les annonces
  urgentes et importantes sont signalées (« [Urgent] », « [Important] »).
- Taux de lecture = lectures / destinataires comptés au moment de la publication.

## User stories

| # | En tant que… | je veux… | afin de… |
|---|---|---|---|
| US7.1 | administrateur | rédiger une annonce avec pièces jointes et priorité | informer clairement |
| US7.2 | administrateur | cibler une filière, un niveau, un groupe ou un rôle et voir le nombre de destinataires | toucher les bonnes personnes |
| US7.3 | administrateur | programmer l'envoi à une date et une heure | préparer les annonces à l'avance |
| US7.4 | administrateur / enseignant | voir combien de destinataires ont lu l'annonce | mesurer la diffusion |
| US7.5 | enseignant | écrire aux étudiants de mes groupes | les prévenir d'un rendu ou d'un changement |
| US7.6 | étudiant | recevoir une notification push et retrouver l'annonce dans un fil | ne rien rater |
| US7.7 | étudiant | voir les annonces non lues, leur priorité et télécharger les pièces jointes | trier l'essentiel |
| US7.8 | étudiant | lire une annonce hors ligne | la consulter n'importe où |
| US7.9 | tout utilisateur | consulter et marquer mes notifications comme lues | garder un fil propre |

## Critères d'acceptation (extraits)

- **US7.2** — Quand l'administrateur coche le groupe 4TWIN1, alors le formulaire affiche en direct
  « N destinataires » ; sans critère, il indique « Rien de coché : tout le monde la reçoit ».
- **US7.3** — Une annonce programmée pour 8 h est publiée automatiquement à 8 h (au plus 30 s plus tard) et
  les destinataires sont notifiés à ce moment-là, une seule fois même avec plusieurs serveurs.
- **US7.5** — Une enseignante qui tente de cibler un groupe où elle n'enseigne pas reçoit « Tu peux seulement
  écrire aux groupes où tu enseignes » et l'annonce n'est pas enregistrée.
- **US7.7** — Le fil montre « Nouveau » sur les annonces non lues ; ouvrir une annonce la marque comme lue.
  Un étudiant ne peut ni voir ni télécharger une annonce qui ne lui est pas destinée.
- **US7.8** — Une annonce ouverte hors ligne est affichée depuis le cache ; sa lecture est enregistrée au retour
  du réseau (« 1 modification en attente de synchronisation »).

## Écrans

`/dashboard/announcements` (fil), `/dashboard/announcements/[id]` (détail), widget « Dernières annonces »,
`/dashboard/notifications`, `/dashboard/admin/announcements` (liste, nouvelle, modification, statistiques).
