# Chema

Application personnelle pour téléphone : budgets **CHF** et **MAD** séparés, échéances et rappels,
coffre à documents, objectifs d'épargne. Une seule utilisatrice, pas de compte, pas de serveur,
pas de connexion bancaire. Les données restent **sur le téléphone**.

---

## 1. Choix techniques (résumé)

### Application web installable (PWA) ou application native ?

| | PWA (choisie) | Application native (iOS/Android) |
|---|---|---|
| Installation | Depuis le navigateur, « Sur l'écran d'accueil ». Aucun store. | App Store / Play Store, ou installation de développeur. Sur iPhone : compte développeur Apple (99 USD/an) ou réinstallation tous les 7 jours. |
| Mises à jour | Automatiques à l'ouverture. | Via le store ou réinstallation. |
| Hors ligne | Oui (service worker). | Oui. |
| Rappels à heure fixe, app fermée | **Non fiable** (voir § 6). | **Oui**, notifications locales programmées. |
| Face ID / empreinte | Possible via « clé d'accès » (WebAuthn), si le téléphone l'expose au site. | Oui, API natives. |
| Stockage | Base du navigateur (IndexedDB), effaçable avec les données du site. | Stockage de l'app, chiffrable par le système. |
| Coût / complexité | Faible : un hébergement statique HTTPS suffit. | Plus élevé : outils Apple/Google, signature, publication. |

### Stockage uniquement sur le téléphone ou synchronisation ?

| | Local uniquement (choisi) | Synchronisation entre appareils |
|---|---|---|
| Confidentialité | Maximale : rien ne quitte le téléphone. | Les données (chiffrées ou non) passent par un serveur ou un cloud. |
| Compte | Aucun. | Nécessaire (ou clé de chiffrement à gérer). |
| Perte du téléphone | Données perdues **sans sauvegarde**. | Données récupérables. |
| Plusieurs appareils | Non (transfert par sauvegarde/restauration). | Oui. |

**Par défaut** : PWA locale et indépendante. Ce choix limite surtout les **notifications quand
l'application est fermée** ; c'est expliqué dans l'application et au § 6, avec des solutions.

Technologies : Preact + TypeScript, Vite, IndexedDB, WebCrypto (AES-GCM / PBKDF2), service worker
écrit à la main. Polices et icônes embarquées : **aucune requête vers un service externe** (la
politique de sécurité de la page l'interdit d'ailleurs : `connect-src 'self'`).

---

## 2. Lancer l'application et l'installer sur le téléphone

L'application est un ensemble de fichiers statiques (dossier `dist/`). Pour l'utiliser sur un
téléphone, il faut la servir en **HTTPS** (obligatoire pour l'installation, le mode hors ligne,
le chiffrement des sauvegardes et la biométrie). L'hébergeur ne fournit que le code : il ne voit
jamais vos données, qui restent dans le téléphone.

### Option A — GitHub Pages (gratuit)
1. Créez un dépôt GitHub (public pour la version gratuite de Pages : le **code** sera public, vos
   **données** non, elles ne sont jamais dans le dépôt).
2. Déposez le **contenu** du dossier `dist/` à la racine du dépôt (ou d'une branche `gh-pages`).
3. Dépôt › Settings › Pages › « Deploy from a branch » › choisissez la branche et `/ (root)`.
4. Ouvrez l'adresse `https://<votre-nom>.github.io/<depot>/` sur le téléphone.

### Option B — Netlify / Cloudflare Pages
Glissez-déposez le dossier `dist/` dans l'interface « Deploy » (compte gratuit requis), puis ouvrez
l'adresse HTTPS fournie.

### Installer sur l'écran d'accueil
- **iPhone (Safari)** : ouvrez l'adresse › bouton **Partager** › **« Sur l'écran d'accueil »**.
  Ouvrez ensuite l'app depuis son icône et **saisissez vos données dans l'app installée** (sur
  iPhone, Safari et l'app installée ont des espaces de stockage séparés).
- **Android (Chrome)** : menu ⋮ › **« Installer l'application »** (ou bouton « Installer » proposé
  sur l'accueil).

### En local, pour développer
```bash
npm install
```
```bash
npm run dev
```
```bash
npm run build
```
```bash
npm test
```
```bash
npm run e2e
```
`npm run e2e` lance 23 parcours de bout en bout sur un téléphone simulé (Chromium + Playwright,
qui doit être installé). Attention : un téléphone qui ouvre `http://<ip-de-l-ordinateur>:4173`
n'est pas en HTTPS — l'app s'affiche mais sans installation, hors ligne, chiffrement ni biométrie.

---

## 3. Utilisation au quotidien

- **Bouton +** (toujours visible) : *Dépense* (montant, monnaie, catégorie — date du jour par défaut,
  3 à 4 touches), *Ticket (photo)*, *Échéance*, *Document*.
- **Accueil** : budget restant CHF et MAD côte à côte, prochaines échéances (demain en jaune,
  retards en rouge), objectifs d'épargne. Icônes en haut : recherche globale et réglages.
- **Détection des charges fixes** : importez 2 à 6 mois de relevés CSV, puis Budget › Charges fixes ›
  icône loupe (ou le bandeau proposé à la fin d'un import). Chema repère, sur le téléphone, les paiements
  qui reviennent au même bénéficiaire vers le même jour avec un montant stable ou proche (montant
  variable signalé), et les propose : vous cochez, corrigez nom/montant/jour/fréquence/catégorie, puis
  validez. Les paiements déjà importés sont rattachés à leur charge (mois passés « payés », mois passés
  sans paiement « ignorés », mois en cours « prévu » s'il n'est pas encore payé). Courses fréquentes,
  retraits d'espèces et abonnements arrêtés ne sont pas proposés.
- **Budget** : mois par mois et monnaie par monnaie ; charges fixes du mois (toucher une charge pour
  la marquer payée en ajustant le montant réel, l'ignorer ce mois-ci, ou modifier ses paramètres) ;
  totaux par catégorie et plafonds ; bouton liste = écran « Opérations » filtrable (période,
  monnaie, catégorie, type) ; bouton import = relevé CSV.
- **Échéances** : filtres (à faire, en retard, 30 jours, historique, type). Détail : terminer,
  reporter d'un jour / d'une semaine, ouvrir le document lié, créer la dépense d'une facture,
  exporter vers le calendrier. Contrats : date limite de résiliation calculée (fin − préavis),
  modifiable à la main.
- **Documents** : recherche, filtres pays/catégorie, aperçu, liens vers dépenses et échéances. Une
  date d'expiration crée (puis met à jour) une échéance « Fin de validité » liée.
- **Épargne** (depuis l'Accueil) : objectifs par monnaie, versements/retraits, historique,
  mensualité estimée, liste « Réalisés ».
- **Annuler** : chaque action affiche un message avec « Annuler ». Les suppressions passent par la
  **corbeille** (Réglages › Corbeille, 30 jours).

### Premier démarrage conseillé
1. Réglages › **Budgets** : montant mensuel CHF et MAD (+ plafonds facultatifs).
2. Budget › **Importer** vos relevés CSV des derniers mois, puis **Charges fixes › Détecter** (ou saisie
   à la main : loyer, assurances, abonnements, Wi-Fi…).
3. **+ › Échéance** : factures, résiliations, impôts, documents qui expirent.
4. Réglages › **Sauvegarde** : une première sauvegarde chiffrée.

### Sauvegarde et restauration
- Réglages › Sauvegarde › **Exporter une sauvegarde** : avec mot de passe (recommandé) → fichier
  chiffré AES-256 ; sans mot de passe → fichier lisible, avec avertissement. Option pour inclure ou
  non les photos/PDF. Le fichier est proposé au partage (« Enregistrer dans Fichiers », clé USB,
  ordinateur…) — rien n'est envoyé automatiquement.
- **Restaurer depuis un fichier** : choisir le fichier, saisir le mot de passe, vérifier le résumé,
  confirmer. Les données actuelles de l'app sont **remplacées**.
- Le code de verrouillage et la biométrie sont propres à chaque téléphone : à réactiver après une
  restauration.

---

## 4. Où sont stockées les données ?

- Dans **IndexedDB**, la base de données locale du navigateur, sur le téléphone : dépenses,
  charges fixes, échéances, documents (fichiers inclus, sous forme de *Blob*), objectifs, réglages.
- Aucun serveur, aucun cloud, aucune synchronisation, aucun compte.
- Les photos sont réduites (2000 px max) pour économiser l'espace.
- Le fichier CSV importé est lu en mémoire puis oublié : seules les opérations validées sont
  enregistrées, sans les colonnes de numéros de compte/carte.
- L'app demande au navigateur de protéger ces données contre l'effacement automatique
  (Réglages › Stockage indique si c'est accordé).

**Ce qui efface les données** : supprimer l'icône de l'app (iPhone), effacer les données du site dans
le navigateur, réinitialiser/perdre le téléphone, changer d'adresse d'hébergement (nouvel espace
vide). Sur iPhone, un site **non installé** inutilisé 7 jours peut être vidé par Safari.
**Seule une sauvegarde régulière protège contre ces pertes.** L'accueil rappelle de sauvegarder
après 30 jours.

---

## 5. Fonctionnalités opérationnelles

- 4 onglets + bouton + ; formulaires courts ; dates jj.mm.aaaa ; textes en français.
- Budgets CHF/MAD indépendants, budget global et plafonds par catégorie (historisés par mois),
  barre orange à 80 %, rouge au dépassement ; restant = budget − dépenses confirmées − charges
  prévues non payées ; « pas le solde bancaire » affiché.
- Saisie rapide ; ticket photo rangé dans « Reçus » ; lecture automatique uniquement si le
  navigateur offre une détection de texte locale (sinon saisie manuelle).
- Charges fixes : fréquence, jour, début/fin, suspension, montant réel par mois sans toucher à la
  base (ou mise à jour explicite de la base), mois ignoré, pas de double comptage ; **détection
  automatique depuis les relevés importés**, avec validation.
- Import CSV : séparateurs/encodages/dates/montants courants, choix des colonnes, débit/crédit,
  lignes illisibles signalées, catégories proposées (et apprises), doublons à confirmer, crédits
  classés en remboursement ou autre entrée, rapprochement avec les charges fixes, résumé final.
- Remboursements liés à une dépense (corrigent la catégorie et le mois choisi, pas comptés comme
  revenu) ; « autres entrées » hors budget ; modification/suppression avec corbeille et annulation ;
  choix explicite du sort du reçu lié.
- Échéances : 4 types, statuts (à faire, en cours, terminée, en retard), récurrence avec création
  automatique de la suivante, report, documents liés, création de dépense confirmée, préavis.
- Coffre : photo/PDF/capture, pays, catégories modifiables, expiration ↔ échéance liée unique,
  liens, recherche globale ; avertissements Banque/Identité, masquage des numéros sur image,
  détection (imparfaite) des IBAN/cartes/AVS/passeports dans les textes.
- Épargne : objectifs multiples par monnaie, versements/retraits, mensualité estimée, « Réalisés ».
- Verrouillage par code (toute l'app ou coffre seul), biométrie via clé d'accès si disponible.
- Sauvegarde chiffrée / non chiffrée, restauration, effacement total confirmé.
- Hors ligne après la première ouverture.

---

## 6. Limites à connaître

**Notifications.** Une PWA ne peut pas programmer elle-même une notification « la veille à 18 h »
quand elle est fermée :
- *iPhone* : les notifications web exigent un serveur d'envoi (Web Push). Aucun serveur n'est
  utilisé ici, donc **pas de notification app fermée**.
- *Android/Chrome* : une vérification en arrière-plan est demandée au navigateur (« periodic
  background sync »), mais c'est lui qui décide quand (souvent 1×/jour au mieux) : **non garanti**.
- *App ouverte* : rappel affiché (et notification système si autorisée) à l'heure réglée.
- *Toujours* : à l'ouverture, retards en rouge et « rappels manqués » mis en évidence.
- **Solution fiable sans serveur : l'export calendrier (.ics)** (Échéances › icône calendrier, ou
  Réglages › Rappels) : le calendrier du téléphone prévient la veille, même app fermée et hors
  ligne. Inconvénient : à réexporter si une date change (risque de doublons), et les titres des
  échéances se retrouvent dans votre calendrier (éventuellement synchronisé iCloud/Google).
- Pour des notifications automatiques fiables : (1) emballer cette app en **application native**
  (ex. Capacitor) avec notifications locales — recommandé pour la confidentialité ; ou (2) un
  **petit serveur Web Push** qui connaîtrait vos dates d'échéance — moins confidentiel. Rien de cela
  n'est activé sans votre décision.

**Biométrie.** Face ID / empreinte passent par une « clé d'accès » WebAuthn que le téléphone crée
pour ce site (elle peut apparaître dans le trousseau/gestionnaire de mots de passe). L'option n'est
proposée que si le téléphone la rend réellement disponible. Le verrou (code ou biométrie) protège
l'**accès à l'interface** ; il **ne chiffre pas** les données stockées dans le navigateur, dont la
protection repose sur le verrouillage et le chiffrement du téléphone. Code oublié = effacement puis
restauration d'une sauvegarde.

**Sauvegarde.** Manuelle uniquement. Le chiffrement (AES-256-GCM, PBKDF2 600 000 itérations) est
fiable si le mot de passe est solide ; mot de passe perdu = sauvegarde irrécupérable. Le
chiffrement exige HTTPS. Les grosses sauvegardes (beaucoup de photos) peuvent être lentes sur un
téléphone ancien : l'option « sans fichiers » existe.

**Changement d'appareil.** Pas de synchronisation : exporter sur l'ancien téléphone, installer
l'app sur le nouveau (même adresse ou non), restaurer. Réactiver ensuite le verrou.

**Données sensibles.** La détection de numéros (IBAN, cartes, AVS, passeports) dans les textes et
les CSV est une aide, pas une garantie. Les PDF ne peuvent pas être masqués dans l'app (astuce :
capture d'écran de la page utile, puis masquage de l'image).

**Lecture des tickets.** Pas d'OCR embarqué : la plupart des téléphones (dont Safari/iPhone)
n'offrent pas de détection de texte locale au navigateur. La photo est conservée, la saisie reste
manuelle.

**Aperçu PDF.** Selon le navigateur, l'aperçu intégré peut n'afficher que la première page : utilisez
« Ouvrir / partager ».

---

## 7. Personnaliser

- **Couleurs** : toutes dans `src/styles/tokens.css` (Mellow Yellow, Red Riding Hood #551C25,
  Country Air, ivoire/crème/gris chaud, états orange/rouge).
- **Catégories** : modifiables dans l'app (Réglages › Catégories).
- **Icônes** : `public/icons/favicon.svg`, puis `npm run icons` (nécessite Playwright).

## Structure

```
src/
  lib/        logique pure testée : dates, montants, budgets, charges fixes, échéances, CSV,
              données sensibles, chiffrement, ics, épargne
  db/         IndexedDB, état réactif, actions (annuler, corbeille), fichiers, sauvegarde
  services/   rappels/notifications, verrouillage, installation, lecture locale des tickets
  screens/    écrans (accueil, budget, import, échéances, documents, épargne, réglages…)
  ui/         composants, navigation, messages et confirmations
public/sw.js  service worker (hors ligne + vérification périodique Android)
tests/        tests unitaires (Vitest) et parcours mobiles (Playwright)
```
