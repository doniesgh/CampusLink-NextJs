# Module 1 — Emploi du temps intelligent

**Objectif** : offrir à chaque étudiant et enseignant un emploi du temps personnel, à jour en temps réel et
consultable hors ligne. **Acteurs** : étudiant, enseignant, administration (scolarité).

## Règles de gestion

- Une séance a une matière, un enseignant (rôle `TEACHER`), un ou plusieurs groupes, une salle (facultative), un
  début et une fin le même jour (fuseau du campus, 8 h maximum), un type (cours, TD, TP, examen, autre).
- Une séance programmée ne peut pas chevaucher une autre séance programmée qui partage la **salle**,
  l'**enseignant** ou un **groupe** (conflit refusé, rien n'est enregistré).
- Une série hebdomadaire compte au plus 26 séances ; une modification peut viser « cette séance uniquement » ou
  « cette séance et les suivantes ».
- Un changement de salle, d'horaire ou une annulation d'une séance à venir dans les 14 jours notifie les
  étudiants des groupes et les enseignants concernés (in-app + push), une seule notification par personne.

## User stories

| # | En tant que… | je veux… | afin de… |
|---|---|---|---|
| US1.1 | étudiant | voir mon emploi du temps de la semaine | savoir où et quand j'ai cours |
| US1.2 | étudiant | passer en vue jour, semaine ou mois et filtrer par matière ou enseignant | trouver vite une séance |
| US1.3 | étudiant | voir clairement une salle changée ou un cours annulé | ne pas me tromper de salle |
| US1.4 | étudiant | recevoir une notification immédiate en cas de changement | être prévenu même application fermée |
| US1.5 | étudiant | consulter mon emploi du temps sans réseau | l'avoir dans le bus ou en salle sans Wi-Fi |
| US1.6 | étudiant / enseignant | l'ajouter à Google Agenda ou à mon calendrier iCal | le retrouver dans mon agenda habituel |
| US1.7 | enseignant | voir les séances que j'assure | organiser ma semaine |
| US1.8 | administrateur | créer une séance ou une série hebdomadaire | construire l'emploi du temps d'un groupe |
| US1.9 | administrateur | être averti des conflits de salle, d'enseignant ou de groupe | éviter les doubles réservations |
| US1.10 | administrateur | importer un emploi du temps complet depuis un CSV | ne pas tout ressaisir |
| US1.11 | administrateur | modifier, annuler, rétablir ou supprimer une séance | suivre les imprévus |

## Critères d'acceptation (extraits)

- **US1.1** — Étant donné une étudiante du groupe 4TWIN1, quand elle ouvre « Emploi du temps », alors elle voit
  les séances de son groupe pour la semaine courante (lundi → dimanche, fuseau du campus). Un étudiant sans
  groupe voit « Tu n'es pas encore inscrit dans un groupe. ».
- **US1.3** — Quand l'administration change la salle d'une séance de C201 à A04, alors la carte de la séance
  affiche A04 et « Déplacé depuis C201 » ; une séance annulée apparaît barrée avec « Annulé ».
- **US1.4** — Quand une séance qui commence dans moins de 14 jours change de salle, alors chaque étudiant du
  groupe et l'enseignant reçoivent une notification dans leur langue (ex. « Bases de données : salle changée
  B12 → A04 (mar. 8 oct., 10:30) »).
- **US1.5** — Après une première consultation en ligne, l'emploi du temps reste affiché sans réseau, avec le
  bandeau « Tu es hors ligne » et l'heure de dernière mise à jour.
- **US1.9** — Quand l'administrateur ajoute une séance dans une salle déjà occupée, alors un message
  « Conflit » liste la ou les séances en conflit et rien n'est enregistré.
- **US1.10** — Le fichier CSV (`date, start, end, subject_code, teacher_email, groups, room, type, notes`) peut
  être vérifié à blanc ; une ligne invalide ou en conflit est signalée avec son numéro et rien n'est importé.

## Écrans

`/dashboard/timetable` (personnel), widget « Tes cours du jour » du tableau de bord,
`/dashboard/admin/timetable` (gestion par groupe, enseignant ou salle, ajout, modification, import CSV).
