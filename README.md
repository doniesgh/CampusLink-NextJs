# CampusLink

Plateforme collaborative pour la vie étudiante : une **PWA installable et utilisable hors ligne** qui regroupe
l'emploi du temps, les annonces, les réservations de salles, le forum d'entraide, le suivi étudiant, le
covoiturage, la marketplace de notes et le réseau alumni. Projet de 4e année (ESPRIT), d'après le cahier des
charges du projet.

## Modules

| # | Module | État |
|---|---|---|
| 1 | Emploi du temps intelligent | ✅ |
| 2 | Covoiturage étudiant (chat en temps réel) | ✅ |
| 3 | Marketplace de cours et de notes (jetons fictifs) | ✅ |
| 4 | Forum d'entraide par matière | ✅ |
| 5 | Réservation de salles et de matériel | ✅ |
| 6 | Annuaire et réseau alumni | ✅ |
| 7 | Notifications et annonces administratives | ✅ |
| 8 | Mode hors ligne complet (PWA) | ✅ |
| 9 | Tableau de bord analytics étudiant | ✅ |
| 10 | Authentification et rôles | ✅ rôles, 2FA, journal d'audit — SSO et Google à venir |
| 11–18 | Modules complémentaires | phase suivante |

Interface en **français** (par défaut) et en **anglais**. Une application mobile **Flutter** utilisera la même API.

## Démarrage rapide

```bash
# MongoDB local (ou service Windows MongoDB, ou MongoDB Atlas)
docker run -d --name campuslink-mongo -p 27017:27017 mongo:7

cd backend && npm install && cp .env.example .env   # remplir JWT_SECRET, puis : npm run generate-vapid
npm run seed:demo                                    # données de démonstration (facultatif)
npm run dev                                          # API sur http://localhost:4000

cd ../next && npm install && cp .env.example .env.local
npm run dev                                          # site sur http://localhost:3000
```

Comptes de démonstration (mot de passe `Campus123!`) : `admin@campuslink.local` (administration),
`amira.bensalah@campuslink.local` (enseignante), `yasmine.haddad@campuslink.local` (étudiante, groupe 4TWIN1) —
la liste complète s'affiche à la fin de `npm run seed:demo`.

Guide complet (variables, production, HTTPS, sauvegardes) : [docs/deploiement.md](docs/deploiement.md).

## Stack

Next.js 16 (App Router, React 19, Tailwind CSS 4, next-intl) · Express 5 · MongoDB (Mongoose 9) · Socket.IO ·
Web Push · Playwright. Détails et justification : [docs/architecture.md](docs/architecture.md).

## Documentation

| Document | Contenu |
|---|---|
| [Architecture](docs/architecture.md) | Vue d'ensemble, choix techniques, sécurité, modèle de données |
| [Installation et déploiement](docs/deploiement.md) | Local, production, nginx/HTTPS, sauvegarde |
| [Spécifications fonctionnelles](docs/specifications/) | User stories et critères d'acceptation par module |
| Contrats techniques ([phase 1](docs/phase1-contract.md), [2](docs/phase2-contract.md), [3](docs/phase3-contract.md)) | API, règles, écrans, en anglais |
| [Qualité](docs/quality/README.md) | Audit Lighthouse (performance, accessibilité) |
| [Démos vidéo](docs/demo/README.md) | Une démo par rôle |
| [backend/README.md](backend/README.md), [next/README.md](next/README.md) | Documentation développeur (et `docs/` de chaque dossier) |

## Tests

```bash
cd tests && npm install && npx playwright install chromium
npm run test:api                                        # API + tests de sécurité
npx playwright test --project=api api/security.spec.ts  # tests de sécurité seuls
```

Les tests démarrent leur propre base MongoDB en mémoire et leurs propres serveurs (ports 27018, 4100, 4101, 3100).

## Structure

```
backend/   API Express (routes, modèles, services, scripts, docs par module)
next/      Application web Next.js (pages, composants, traductions, service worker)
tests/     Tests Playwright (API, sécurité, navigateur)
docs/      Architecture, déploiement, spécifications, contrats, qualité, démos
```
