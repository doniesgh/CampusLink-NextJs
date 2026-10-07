# CampusLink — démos par rôle (phase 1)

Vidéos enregistrées sur l'application réelle (build de production, interface en français, données de démonstration
`npm run seed:demo`). Chaque démo est une vidéo **MP4** (1280×720).

| Rôle | Durée | Ce que montre la démo | Fichiers |
|---|---|---|---|
| Administrateur | 1 min 40 | Utilisateurs (création d'un étudiant dans son groupe), structure académique, gestion de l'emploi du temps (changement de salle notifié, détection de conflit, import CSV), suivi et statistiques des annonces, journal d'audit | [MP4](demo-admin.mp4) |
| Enseignante | 42 s | Son emploi du temps, rédaction d'une annonce ciblée sur ses groupes (nombre de destinataires en direct, pièce jointe PDF), publication et taux de lecture | [MP4](demo-enseignant.mp4) |
| Étudiante | 1 min 10 | Tableau de bord, emploi du temps (salle changée, cours annulé, vues jour/semaine/mois, filtres, export calendrier), notifications, annonces avec pièce jointe, **mode hors ligne**, interface FR/EN | [MP4](demo-etudiant.mp4) |
| Alumni | 30 s | Accès conservé, annonces, compte (langue, validation en deux étapes) ; annuaire et mentorat prévus en phase 3 | [MP4](demo-alumni.mp4) |

Les démos s'enchaînent : la salle changée par l'administrateur et l'annonce publiée par l'enseignante apparaissent
ensuite dans les notifications de l'étudiante.

Comptes de démonstration (mot de passe `Campus123!`) : `admin@campuslink.local`, `amira.bensalah@campuslink.local`,
`yasmine.haddad@campuslink.local`, `selim.rekik@campuslink.local`.

Des versions GIF (8–10 fps, 880–960 px) existent aussi, mais ne sont pas versionnées dans git à cause de leur taille (≈ 26 Mo).
