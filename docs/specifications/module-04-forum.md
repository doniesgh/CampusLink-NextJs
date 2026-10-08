# Module 4 — Forum d'entraide par matière

**Objectif** : un espace de questions-réponses structuré par matière pour l'entraide académique.
**Acteurs** : étudiant, enseignant (réponses certifiées), alumni, administration (modération).

## Règles de gestion

- Question : titre (10–200 caractères), message (20–10 000), **matière** obligatoire, chapitre et niveau
  facultatifs, jusqu'à 5 étiquettes. Texte simple, jamais interprété comme du HTML.
- Réponses multiples ; une réponse d'**enseignant** est **certifiée** ; l'auteur de la question **accepte** une
  réponse (affichée en premier).
- **Votes** +1/−1 sur les questions et les réponses, un par personne (revoter la même valeur annule le vote),
  jamais sur son propre contenu.
- **Réputation** : +10 par vote positif reçu sur une réponse, +5 sur une question, −2 par vote négatif, +15 pour
  une réponse acceptée, +2 à l'auteur qui accepte ; jamais négative. **Badges** : première réponse, contributeur
  actif (10 réponses), aide précieuse (5 réponses acceptées), expert d'une matière (50 points dans la matière),
  chacun notifié.
- **Suivi** : l'auteur suit sa question ; les abonnés sont notifiés de chaque nouvelle réponse, l'auteur d'une
  réponse quand elle est acceptée.
- **Recherche plein texte** (titre, étiquettes, message) et **questions similaires** proposées pendant la saisie
  du titre.
- **Hors ligne** : une réponse écrite sans réseau est mise en file et envoyée au retour, sans doublon
  (identifiant de requête unique).
- **Modération** : tout le monde peut signaler ; l'administration masque, réaffiche ou traite les signalements
  (actions journalisées). Limite : 30 publications (questions, réponses, signalements) par heure.

## User stories

| # | En tant que… | je veux… | afin de… |
|---|---|---|---|
| US4.1 | étudiant | poser une question taguée par matière, chapitre et niveau | obtenir de l'aide ciblée |
| US4.2 | étudiant | voir des questions similaires avant de publier | ne pas créer de doublon |
| US4.3 | étudiant | rechercher et filtrer les questions (matière, niveau, étiquette, sans réponse) | trouver une réponse existante |
| US4.4 | étudiant / enseignant | répondre, voter et accepter une réponse | faire remonter les meilleures réponses |
| US4.5 | enseignant | que mes réponses soient signalées comme certifiées | rassurer les étudiants |
| US4.6 | étudiant | être notifié d'une réponse à une question que je suis | réagir vite |
| US4.7 | étudiant | voir ma réputation et mes badges | valoriser mon aide |
| US4.8 | étudiant | répondre même sans réseau | ne pas perdre ma réponse |
| US4.9 | administrateur | traiter les signalements et masquer un contenu | garder un forum sain |

## Critères d'acceptation (extraits)

- **US4.2** — En tapant « jointure externe SQL » dans le titre, jusqu'à 5 questions proches s'affichent avec
  leur nombre de réponses.
- **US4.4** — Un étudiant ne peut pas voter pour sa propre réponse ; accepter une réponse ajoute 15 points à son
  auteur et 2 à l'auteur de la question.
- **US4.8** — Hors ligne, la réponse apparaît « en attente de synchronisation » et n'est publiée qu'une fois au
  retour du réseau, même si l'envoi est rejoué.
- **US4.9** — Un contenu masqué n'est plus visible que par l'administration et son auteur, avec un avertissement.

## Écrans

`/dashboard/forum` (liste, recherche, nouvelle question), `/dashboard/forum/[id]` (question et réponses),
`/dashboard/forum/profile/[userId]` (réputation et badges), `/dashboard/admin/forum` (modération).
