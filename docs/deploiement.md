# CampusLink — Guide d'installation et de déploiement

Deux parties : **installation locale** (développement, démonstration) et **déploiement en production**
(HTTPS obligatoire pour la PWA et les notifications push). Architecture : voir [`architecture.md`](architecture.md).

## 1. Prérequis

| Outil | Version |
|---|---|
| Node.js | 20 ou plus (testé avec 22) |
| npm | 10 ou plus (le projet utilise npm, pas pnpm) |
| MongoDB | 7 ou plus (local, Docker ou MongoDB Atlas) |
| Docker (facultatif) | pour lancer MongoDB sans l'installer |

## 2. Installation locale

```bash
git clone https://github.com/doniesgh/CampusLink-NextJs.git
cd CampusLink-NextJs

# MongoDB (si non installé) : conteneur local
docker run -d --name campuslink-mongo -p 27017:27017 mongo:7

# API
cd backend
npm install
cp .env.example .env          # puis remplir JWT_SECRET (voir ci-dessous)
npm run generate-vapid        # copier les deux clés affichées dans .env (notifications push)
npm run seed:demo             # données de démonstration (facultatif)
npm run create-admin -- admin@ecole.tn MotDePasseSolide Prénom Nom
npm run dev                   # http://localhost:4000 (redémarre à chaque modification)

# Application web (autre terminal)
cd ../next
npm install
cp .env.example .env.local    # API_URL=http://localhost:4000 par défaut
npm run dev                   # http://localhost:3000
```

Générer `JWT_SECRET` :

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Comptes de démonstration** (après `seed:demo`, mot de passe `Campus123!`) : `admin@campuslink.local`,
`amira.bensalah@campuslink.local` (enseignante), `yasmine.haddad@campuslink.local` (étudiante, groupe 4TWIN1),
`selim.rekik@campuslink.local` (alumni).

**E-mails en local** : sans `SMTP_USER`/`SMTP_PASS`, les e-mails (code de connexion, lien de réinitialisation) ne
sont pas envoyés mais affichés dans la console de l'API.

**Tester le mode hors ligne en local** : le service worker n'est actif qu'en build de production.

```bash
cd next
npm run build
COOKIE_SECURE=false npm start   # http://localhost:3000 ; DevTools > Network > Offline pour tester
```

## 3. Variables d'environnement

### API (`backend/.env`)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `MONGO_URI` | oui | Connexion MongoDB |
| `JWT_SECRET` | oui | Signature des jetons d'accès (64 octets aléatoires) |
| `PORT` | | Port HTTP (4000) |
| `CORS_ORIGINS` | | Origines web autorisées, séparées par des virgules (l'app mobile n'en a pas besoin) |
| `APP_URL` | | URL publique du site (liens dans les e-mails) |
| `PUBLIC_API_URL` | | URL publique de l'API (liens d'abonnement au calendrier) |
| `APP_TIMEZONE` | | Fuseau du campus (`Africa/Tunis`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | en production | Envoi des e-mails (Gmail : mot de passe d'application) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | pour le push | Clés Web Push (`npm run generate-vapid`) |
| `STORAGE_DIR`, `MAX_UPLOAD_MB` | | Dossier et taille max des pièces jointes |
| `TRUST_PROXY` | | Proxys de confiance pour l'IP cliente (`loopback` par défaut) |
| `RATE_LIMIT_*` | | Limitation des tentatives (activée par défaut) |
| `SCHEDULER_INTERVAL_MS`, `NOTIFY_HORIZON_DAYS` | | Tâches de fond, horizon des notifications d'emploi du temps |

La liste complète et commentée est dans `backend/.env.example`.

### Web (`next/.env.local`)

| Variable | Rôle |
|---|---|
| `API_URL` | URL de l'API vue par le serveur Next.js (jamais exposée au navigateur) |
| `NEXT_PUBLIC_APP_TIMEZONE` | Fuseau d'affichage (`Africa/Tunis`) |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys devant Next.js qui écrivent l'IP cliente (1 derrière nginx) |
| `COOKIE_SECURE` | `false` seulement pour un build de production servi en http local |

## 4. Déploiement en production

### 4.1 Cible recommandée

Un serveur Linux (VPS) avec deux noms de domaine :
- `campuslink.example` → application web (Next.js, port 3000) ;
- `api.campuslink.example` → API (Express, port 4000), utilisée aussi par l'app Flutter et les calendriers.

MongoDB peut être sur le même serveur ou sur MongoDB Atlas (offre gratuite suffisante pour une démonstration).

### 4.2 Étapes

```bash
# Sur le serveur
git clone https://github.com/doniesgh/CampusLink-NextJs.git /opt/campuslink && cd /opt/campuslink

cd backend && npm ci --omit=dev && cp .env.example .env   # remplir pour la production (voir 4.3)
cd ../next && npm ci && cp .env.example .env.local        # API_URL=http://127.0.0.1:4000, TRUSTED_PROXY_HOPS=1
npm run build

# Lancer et garder les deux processus actifs (ex. PM2)
npm install -g pm2
NODE_ENV=production pm2 start /opt/campuslink/backend/app.js --name campuslink-api
NODE_ENV=production pm2 start "npm start" --name campuslink-web --cwd /opt/campuslink/next
pm2 save && pm2 startup

# Premier administrateur
cd /opt/campuslink/backend && npm run create-admin -- admin@ecole.tn MotDePasseSolide Prénom Nom
```

### 4.3 Réglages de production

- `NODE_ENV=production` pour les deux processus (cookies `Secure`, e-mails obligatoirement envoyés par SMTP).
- `backend/.env` : `APP_URL=https://campuslink.example`, `PUBLIC_API_URL=https://api.campuslink.example`,
  `CORS_ORIGINS=https://campuslink.example`, `TRUST_PROXY=loopback`, un nouveau `JWT_SECRET`, des clés VAPID
  propres à la production, et les paramètres SMTP.
- `next/.env.local` : `API_URL=http://127.0.0.1:4000`, `TRUSTED_PROXY_HOPS=1`.
- Ne jamais réutiliser les secrets de développement, ni ceux visibles dans l'historique git du projet.

### 4.4 nginx et HTTPS

```nginx
server {
  server_name campuslink.example;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # écrase la valeur envoyée par le client
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
server {
  server_name api.campuslink.example;
  client_max_body_size 60m;                         # pièces jointes (5 fichiers × 10 Mo + marge)
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

Certificats gratuits avec Let's Encrypt : `sudo certbot --nginx -d campuslink.example -d api.campuslink.example`.
Avec nginx devant l'API, passer `TRUST_PROXY=1` dans `backend/.env` pour que l'API lise l'IP réelle.

### 4.5 Vérifications après déploiement

- `https://api.campuslink.example/api/health` répond `{"status":"ok"}`.
- La page de connexion s'affiche en HTTPS, le navigateur propose « Installer l'application ».
- Connexion, puis DevTools > Application : service worker actif, manifeste valide.
- Activer les notifications push dans « Mon compte », puis modifier une salle depuis un compte administrateur :
  la notification arrive.

## 4 bis. Déploiement gratuit : Vercel + Render + MongoDB Atlas

Variante sans serveur à administrer, sur les offres gratuites : le site sur **Vercel**, l'API sur **Render**, la base sur
**MongoDB Atlas** (cluster M0, 512 Mo). HTTPS est fourni par Vercel et Render.

1. **Atlas** : cluster gratuit M0 (AWS, Francfort), utilisateur de base de données, *Network Access* = `0.0.0.0/0`
   (Render n'a pas d'IP fixe), chaîne de connexion `mongodb+srv://…/campuslink?…`.
2. **Render** : *New → Blueprint* sur ce dépôt. Le fichier [`render.yaml`](../render.yaml) crée le service
   `campuslink-api` (dossier `backend`, `npm ci --omit=dev`, `node app.js`, contrôle `/api/health`, région Francfort).
   Renseigner `MONGO_URI`, `APP_URL` et `CORS_ORIGINS` (adresse Vercel), `PUBLIC_API_URL` (adresse Render), les clés
   VAPID (`npm run generate-vapid`) et, pour l'envoi d'e-mails, `SMTP_*`.
   - Pas de disque persistant sur l'offre gratuite : **`STORAGE_DRIVER=gridfs`** range les fichiers envoyés dans MongoDB.
   - `TRUST_PROXY=1` (proxy de Render) et `RATE_LIMIT_IP_MAX=1000` (tous les visiteurs du site arrivent par Vercel).
3. **Vercel** : projet avec *Root Directory* = `next` (ou `vercel deploy` depuis le dossier `next/`), variables
   `API_URL` et `NEXT_PUBLIC_REALTIME_URL` = adresse Render, `NEXT_PUBLIC_APP_TIMEZONE=Africa/Tunis`,
   `TRUSTED_PROXY_HOPS=1`. `NEXT_PUBLIC_*` est lu au build : redéployer après un changement.
   [`next/vercel.json`](../next/vercel.json) impose le framework Next.js et `npm ci` : sans lui, un projet créé en ligne de
   commande est servi comme un site statique (toutes les pages en 404), et l'ancien `pnpm-lock.yaml` fait choisir pnpm
   (exclu de l'envoi par `next/.vercelignore`).
4. **Données** : depuis un poste, `MONGO_URI=<Atlas> STORAGE_DRIVER=gridfs npm run seed:demo` puis
   `npm run create-admin -- <email> <mot de passe>` (dans `backend/`).
5. **Veille** : sans requête pendant 15 min, le service Render gratuit s'endort (premier appel ≈ 50 s). Un moniteur
   gratuit (UptimeRobot, toutes les 5 à 10 min sur `/api/health`) le garde éveillé ; 750 h gratuites par mois suffisent
   pour un service.

Limites : 512 Mo pour les données et les fichiers, temps réel et tâches planifiées sur une seule instance.

Version en ligne actuelle : site `https://campuslink-esprit.vercel.app`, API `https://campuslink-api-kn7w.onrender.com`
(données de démonstration du 8 octobre 2026). Le SMTP n'y est pas encore configuré : le code de connexion par e-mail
(2FA) et la réinitialisation du mot de passe ne fonctionnent pas en ligne ; ne pas y activer la 2FA sur un compte.

## 5. Sauvegarde et mise à jour

- Sauvegarde : `mongodump --uri "$MONGO_URI" --out /sauvegardes/$(date +%F)` et copie de `STORAGE_DIR`.
- Mise à jour : `git pull`, `npm ci` dans `backend/` et `next/`, `npm run build` dans `next/`,
  `pm2 restart campuslink-api campuslink-web`.
- Changer les clés VAPID invalide les abonnements push existants (les utilisateurs doivent les réactiver).

## 6. Tests

```bash
cd tests
npm install
npx playwright install chromium
npm run test:api                                   # API + tests de sécurité (MongoDB en mémoire, ports 27018/4100/4101/3100)
npx playwright test --project=api api/security.spec.ts   # tests de sécurité seuls
```

Les tests démarrent leurs propres serveurs et leur propre base : ils ne touchent pas aux données locales.
