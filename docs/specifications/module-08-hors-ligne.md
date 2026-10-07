# Module 8 — Mode hors ligne complet (PWA)

**Objectif** : garantir l'usage des fonctions essentielles sans connexion. **Acteurs** : tous les utilisateurs.

## Règles de gestion

- L'application est une **PWA installable** (manifeste, icônes 192/512 et maskable, service worker, HTTPS).
- **Coquille de l'application** (fichiers statiques, polices, icônes, page `/offline`) mise en cache au premier
  chargement.
- **Données critiques** (emploi du temps, annonces, notifications) enregistrées dans IndexedDB et affichées
  immédiatement, puis revalidées sur le réseau (*stale-while-revalidate*).
- **Pages** : réseau d'abord, puis copie enregistrée, puis `/offline`. Seules les pages des modules hors ligne
  sont gardées (accueil, emploi du temps, annonces, notifications), liées au compte qui les a vues et
  supprimées après 24 h ; jamais les pages d'administration ni le compte.
- **Actions hors ligne** : mises en file d'attente (IndexedDB) et rejouées au retour du réseau ou via
  Background Sync. En phase 1 : marquer une annonce ou une notification comme lue (opérations idempotentes,
  « la dernière écriture gagne »).
- **Ordinateurs partagés** : à la déconnexion ou à la fin d'une session, les données hors ligne, les pages
  enregistrées et l'abonnement push de l'appareil sont effacés.

## User stories

| # | En tant que… | je veux… | afin de… |
|---|---|---|---|
| US8.1 | utilisateur | installer CampusLink sur mon téléphone ou mon ordinateur | l'ouvrir comme une application |
| US8.2 | étudiant | consulter mon emploi du temps et mes annonces sans réseau | ne pas dépendre du Wi-Fi |
| US8.3 | utilisateur | voir clairement que je suis hors ligne et ce qui attend d'être synchronisé | savoir si mes données sont à jour |
| US8.4 | étudiant | que mes actions hors ligne soient envoyées automatiquement au retour du réseau | ne pas les refaire |
| US8.5 | étudiant sur un poste de laboratoire | que mes données ne restent pas sur l'ordinateur après moi | protéger ma vie privée |

## Critères d'acceptation (extraits)

- **US8.1** — En HTTPS, le navigateur propose l'installation ; l'application s'ouvre en plein écran sur
  `/dashboard`, avec l'icône CampusLink.
- **US8.2** — Après une visite en ligne, recharger `/dashboard/timetable` sans réseau affiche l'emploi du temps
  enregistré ; une page jamais visitée affiche la page « Tu es hors ligne ».
- **US8.3** — Hors ligne, le bandeau « Tu es hors ligne. Affichage des données enregistrées. » est visible, avec
  la date de dernière mise à jour et le nombre de modifications en attente.
- **US8.4** — Une annonce ouverte hors ligne est marquée comme lue sur le serveur dans les secondes qui suivent
  le retour du réseau.
- **US8.5** — Après la déconnexion d'un administrateur, la personne suivante ne peut pas ouvrir hors ligne les
  pages d'administration ni les données du compte précédent.

## Écrans et composants

Bandeau de connexion, page `/offline`, service worker `/sw.js`, manifeste `/manifest.webmanifest`.
