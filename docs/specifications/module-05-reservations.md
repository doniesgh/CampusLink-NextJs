# Module 5 — Réservation de salles et de matériel

**Objectif** : gérer la disponibilité et la réservation des salles, amphis et équipements partagés
(vidéoprojecteurs, matériel de laboratoire…). **Acteurs** : étudiant, enseignant, administration (gestionnaire
des ressources).

## Règles de gestion

- Ressources : les **salles** de la structure académique (réservables ou non, validation obligatoire pour les
  amphithéâtres par défaut) et le **matériel** (vidéoprojecteur, ordinateur, caméra, audio, kit de labo…).
- Créneaux sur une grille de **15 minutes**, le même jour, entre **7 h et 21 h**, dans le futur et au plus
  **60 jours** à l'avance. Durée maximale : **3 h** pour un étudiant, **8 h** pour un enseignant ou
  l'administration. Un étudiant a au plus **3 réservations à venir**. Les alumni ne réservent pas.
- **Aucune double réservation** : une réservation en attente ou confirmée ne peut chevaucher une autre
  réservation de la même ressource, ni un **cours programmé** dans la salle. Chaque réservation « prend » ses
  créneaux de 15 min dans un index unique : deux demandes simultanées ne peuvent pas obtenir le même créneau.
- **Verrouillage optimiste** : accepter, refuser ou annuler indique la version lue ; si quelqu'un a modifié la
  réservation entre-temps, l'action est refusée (« conflit de version »).
- Ressource avec validation → réservation **en attente**, les administrateurs sont notifiés ; la décision
  (avec note, obligatoire pour un refus) notifie le demandeur. Sinon la réservation est **confirmée**.
- **Rappel** in-app et push **60 minutes** avant une réservation confirmée.
- Annulation par l'auteur avant le début, ou par l'administration à tout moment. Limite : 30 créations et
  30 annulations par heure et par utilisateur.
- Les non-administrateurs ne voient jamais l'identité des autres réservations (« Réservé », « Cours »).

## User stories

| # | En tant que… | je veux… | afin de… |
|---|---|---|---|
| US5.1 | étudiant / enseignant | voir la disponibilité d'une salle ou d'un équipement sur la journée ou la semaine | choisir un créneau libre |
| US5.2 | étudiant | trouver les salles libres sur un créneau, avec une capacité minimale | réviser en groupe |
| US5.3 | étudiant / enseignant | réserver une salle ou du matériel en indiquant l'objet | sécuriser mon créneau |
| US5.4 | étudiant | être prévenu si mon créneau est déjà pris (cours ou autre réservation) | ne pas réserver en double |
| US5.5 | étudiant / enseignant | retrouver mes réservations à venir et passées, et en annuler une | gérer mon planning |
| US5.6 | administrateur | valider ou refuser les demandes sur les ressources sensibles | contrôler leur usage |
| US5.7 | utilisateur | recevoir un rappel avant mon créneau | ne pas l'oublier |
| US5.8 | administrateur | gérer le matériel et consulter les statistiques d'utilisation | piloter les ressources |

## Critères d'acceptation (extraits)

- **US5.3** — Une réservation de 2 h de la salle B12 un mardi à 14 h est confirmée immédiatement ; une demande
  sur l'Amphi A passe « en attente » et les administrateurs reçoivent une notification.
- **US5.4** — Si un cours a lieu dans la salle, la réservation est refusée avec un conflit de type « Cours » ;
  dix demandes simultanées pour le même créneau aboutissent à une seule réservation.
- **US5.6** — Deux administrateurs qui décident en même temps : l'un réussit, l'autre reçoit un conflit de
  version et voit la décision déjà prise.
- **US5.8** — Les statistiques donnent, par ressource, le nombre de réservations, les heures réservées et le
  taux d'occupation (heures réservées / heures d'ouverture du lundi au samedi, 7 h–21 h).

## Écrans

`/dashboard/bookings` (disponibilités, salles libres, réservation, mes réservations),
`/dashboard/admin/bookings` (demandes à valider, toutes les réservations, matériel, statistiques).
