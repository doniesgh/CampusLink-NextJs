# Module 10 — Authentification et gestion des rôles (partie phase 1)

**Objectif** : sécuriser l'accès et adapter les fonctions visibles au profil. **Acteurs** : tous les utilisateurs.

## Règles de gestion

- Rôles : étudiant, enseignant, administrateur, alumni ; permissions par module (voir
  [`architecture.md`](../architecture.md), section 4). L'inscription publique crée un compte étudiant.
- Mot de passe de 8 caractères minimum, haché ; même message pour un e-mail inconnu et un mauvais mot de passe.
- Validation en deux étapes facultative : code à 6 chiffres par e-mail, valable 10 minutes, 5 essais.
- Session : jeton d'accès de 15 minutes renouvelé automatiquement, session de 30 jours avec « Rester connecté ».
- Changer ou réinitialiser son mot de passe déconnecte les autres sessions.
- Les actions sensibles (comptes, rôles, structure académique, emploi du temps, annonces, mots de passe) sont
  inscrites dans le journal d'audit.
- Hors périmètre phase 1 : SSO de l'établissement et connexion Google.

## User stories

| # | En tant que… | je veux… | afin de… |
|---|---|---|---|
| US10.1 | visiteur | créer un compte étudiant | accéder à CampusLink |
| US10.2 | utilisateur | me connecter, rester connecté et me déconnecter | utiliser l'application en sécurité |
| US10.3 | utilisateur | réinitialiser mon mot de passe oublié par e-mail | retrouver l'accès à mon compte |
| US10.4 | utilisateur | activer la validation en deux étapes | protéger mon compte |
| US10.5 | utilisateur | choisir ma langue (français ou anglais) | utiliser l'application dans ma langue |
| US10.6 | administrateur | créer des comptes, attribuer les rôles et placer les étudiants dans un groupe | gérer les accès |
| US10.7 | administrateur | consulter le journal d'audit | savoir qui a fait quoi et quand |

## Critères d'acceptation (extraits)

- **US10.2** — Sans session, ouvrir `/dashboard` redirige vers `/login?next=/dashboard`, puis revient à la page
  demandée après connexion. Au-delà de 20 tentatives en 15 minutes (réglable), la connexion est refusée
  temporairement avec « Trop de tentatives. Patiente un peu, puis réessaie. ».
- **US10.4** — Avec la validation activée, la connexion demande le code reçu par e-mail ; un code faux affiche
  « Ce code est invalide ou a expiré. » ; trop d'essais renvoient à l'étape e-mail/mot de passe.
- **US10.6** — Un étudiant ou un alumni qui ouvre une page d'administration est renvoyé au tableau de bord ;
  l'API répond 403 à toute action réservée.
- **US10.7** — Le changement de salle d'une séance apparaît dans le journal avec l'auteur, l'action, la cible,
  la date et l'adresse IP.

## Écrans

`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/dashboard/account`, `/dashboard/admin/users`,
`/dashboard/admin/academic`, `/dashboard/admin/audit`.
