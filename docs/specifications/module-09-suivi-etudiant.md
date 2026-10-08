# Module 9 — Tableau de bord analytics étudiant

**Objectif** : donner à chaque étudiant une vision claire de son assiduité et de sa progression.
**Acteurs** : étudiant, enseignant, administration (scolarité).

## Règles de gestion

- **Appel** : l'enseignant de la séance (de 15 min avant le début à 7 jours après la fin) ou l'administration
  (à tout moment) note Présent, Absent ou En retard pour chaque étudiant des groupes de la séance ; seule
  l'administration pose ou retire « Excusé ». Pas d'appel sur une séance annulée. Modifications journalisées.
- **Taux d'absence** par étudiant et par matière = heures d'absence non excusées / heures des séances tenues ;
  un retard compte comme une présence.
- **Alertes** : avertissement à **10 %**, alerte à **20 %** (réglables) — une seule fois par niveau et par
  matière, notifiée à l'étudiant et visible par l'administration.
- **Évaluations et notes** : l'enseignant qui enseigne la matière au groupe cette année crée les évaluations
  (type, date, barème, coefficient), saisit les notes et les **publie** (notification aux étudiants). Une note non
  publiée n'est jamais visible par l'étudiant. Une évaluation publiée ne peut être supprimée que par
  l'administration. Toutes les opérations sont journalisées.
- **Moyennes** pondérées sur 20 par matière et générale, évolution dans le temps.
- **Comparaison anonymisée** (au choix de l'étudiant) : moyennes du groupe affichées seulement quand **au moins
  5 étudiants** contribuent à chaque chiffre ; jamais de donnée individuelle.
- **Activité** sur 12 semaines : questions et réponses au forum, annonces lues.
- **Bilan PDF** (A4, dans la langue de l'étudiant) : assiduité et notes, pour les démarches administratives ;
  20 téléchargements par heure au plus.

## User stories

| # | En tant que… | je veux… | afin de… |
|---|---|---|---|
| US9.1 | enseignant | faire l'appel rapidement (« Tous présents », puis exceptions) | suivre l'assiduité |
| US9.2 | étudiant | voir mon taux d'absence par matière et être prévenu avant le seuil | éviter les problèmes |
| US9.3 | administrateur | voir les étudiants en alerte, par groupe | intervenir tôt |
| US9.4 | enseignant | créer une évaluation, saisir et publier les notes | informer les étudiants |
| US9.5 | étudiant | voir mes notes, mes moyennes et leur évolution | suivre ma progression |
| US9.6 | étudiant | me comparer, de façon anonyme, à la moyenne du groupe | me situer |
| US9.7 | étudiant | télécharger mon bilan en PDF | le joindre à une démarche |
| US9.8 | administrateur | consulter le suivi complet d'un étudiant et son PDF | accompagner l'étudiant |

## Critères d'acceptation (extraits)

- **US9.2** — Une étudiante absente 3 h sur 22 h de cours de Développement web reçoit un avertissement (13,6 %),
  une seule fois ; à 20 % elle reçoit une alerte et apparaît dans la liste de l'administration.
- **US9.4** — Un enseignant qui ne fait pas cours à ce groupe ne peut ni créer d'évaluation ni saisir de note ;
  après publication, chaque étudiant du groupe est notifié.
- **US9.6** — Si moins de 5 étudiants ont une note dans une matière, la moyenne du groupe n'est pas affichée pour
  cette matière.
- **US9.7** — Le PDF ne peut être téléchargé que par l'étudiant concerné ou par l'administration.

## Écrans

`/dashboard/analytics` (mon suivi), `/dashboard/attendance` (appel), `/dashboard/grades` (évaluations et notes),
`/dashboard/admin/analytics` (alertes, vue par groupe, fiche étudiant + PDF).
