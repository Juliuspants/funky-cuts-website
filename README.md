# Funky Cuts — Online-Terminbuchung 💈

Einfache Terminbuchungs-Website für einen Friseursalon: Kunden buchen sich
selbst einen Termin, der Salon-Betreiber verwaltet Öffnungszeiten, Pausen
und Leistungen über einen eigenen Admin-Bereich.

- **Kunden:** `/` — Startseite mit Vorstellung, Foto-Galerie und Infos,
  Buchung selbst läuft unter `/buchen/`: Leistung wählen → Tag wählen →
  Uhrzeit wählen → Kontaktdaten → fertig. Ist ein Tag ausgebucht, können sich
  Kund*innen auf eine Warteliste eintragen. Wiederkehrende Kund*innen (per
  Telefonnummer erkannt) bekommen ihre zuletzt gebuchte Leistung vorgeschlagen.
- **Admin:** `/admin` — Login, Termine einsehen/stornieren, Öffnungszeiten
  einstellen, Tage blockieren (Urlaub, Pause), Warteliste verwalten,
  Leistungen anlegen/deaktivieren/löschen, Startseiten-Texte und
  Foto-Galerie bearbeiten.

Läuft als Node/Express-App, Daten liegen in einer **Supabase-Postgres-Datenbank**
(kostenloser Cloud-Speicher, kein lokaler Dateispeicher nötig). Gehostet wird
über **Netlify** (kostenlos): statische Dateien direkt über Netlifys CDN,
API über eine einzelne Netlify Function.

## 1. Lokal einrichten

Voraussetzung: [Node.js](https://nodejs.org/) Version 18 oder neuer, sowie ein
kostenloses [Supabase](https://supabase.com)-Projekt (siehe unten).

```bash
npm install
```

`.env`-Datei anlegen (Kopie von `.env.example`):

```bash
cp .env.example .env
```

Darin `DATABASE_URL` (Supabase-Verbindungsstring, siehe Abschnitt 4) und
`JWT_SECRET` (eigener Zufallswert) eintragen:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 2. Admin-Zugang anlegen

Einmalig einen Benutzernamen + Passwort für den Admin-Bereich vergeben:

```bash
npm run set-admin-password -- funky geheimespasswort123
```

(Benutzername und Passwort frei wählbar, Passwort mind. 6 Zeichen. Das
Kommando kann jederzeit erneut ausgeführt werden, um das Passwort zu ändern —
läuft direkt gegen die Supabase-Datenbank, egal ob lokal oder live.)

## 3. Starten

```bash
npm start
```

Dann im Browser öffnen: `http://localhost:3000` (Kunden-Ansicht) bzw.
`http://localhost:3000/admin` (Admin-Login).

Für die Entwicklung mit Auto-Reload bei Codeänderungen:

```bash
npm run dev
```

## 4. Supabase-Projekt einrichten (einmalig)

1. Kostenloses Konto auf [supabase.com](https://supabase.com) anlegen, neues
   Projekt erstellen (Region z.B. Frankfurt).
2. Im Dashboard: **Project Settings → Database → Connection string** →
   Reiter **„Connection pooling"**, Modus **„Transaction"** — diese URL in
   `DATABASE_URL` eintragen (Passwort war beim Projekt-Anlegen sichtbar,
   sonst dort zurücksetzen).
3. Tabellen werden beim ersten Start automatisch angelegt (`npm start` oder
   erster Aufruf der Netlify Function) — kein manuelles SQL nötig.

## 5. Deployment auf Netlify

1. Projekt in ein (privates) GitHub-Repository pushen (bereits erledigt).
2. Auf [netlify.com](https://netlify.com) kostenlos anmelden → **„Add new
   site" → „Import an existing project"** → GitHub-Repo auswählen.
3. Build-Einstellungen übernimmt Netlify automatisch aus `netlify.toml`
   (Build-Befehl `npm install`, Publish-Ordner `public`, Functions-Ordner
   `netlify/functions`) — nichts weiter einzustellen.
4. Unter **Site settings → Environment variables** alle Werte aus der
   lokalen `.env` eintragen (`DATABASE_URL`, `JWT_SECRET`, `SALON_NAME`,
   `CONTACT_EMAIL`, `TZ`, `SMTP_*`, `ADMIN_NOTIFY_EMAIL`).
5. Deploy anstoßen — danach ist die Seite unter einer `*.netlify.app`-URL
   live.
6. Eigene Domain verbinden: **Site settings → Domain management → Add a
   domain**. Netlify zeigt dann entweder DNS-Einträge (A/CNAME) zum Setzen
   beim Domain-Anbieter, oder bietet eine Weiterleitung an — beim jeweiligen
   Registrar (z.B. Hostinger) unter „Domain verwalten" eintragen. SSL
   (https) richtet Netlify danach automatisch und kostenlos ein.

## Standard-Daten beim ersten Start

Beim allerersten Start werden automatisch angelegt:

- Öffnungszeiten: Mo–Fr 09:00–18:00, Sa 09:00–14:00, So geschlossen
  (änderbar im Admin-Bereich unter „Öffnungszeiten“).
- Vier Beispiel-Leistungen (Herrenhaarschnitt, Waschen/Schneiden/Föhnen,
  Bart trimmen, Komplettpaket) — im Admin-Bereich unter „Leistungen“
  anpassen, deaktivieren, löschen (nur möglich ohne bestehende Termine) oder
  neue hinzufügen. Preise werden nur intern gepflegt und tauchen nirgends auf
  der Website auf.
- Terminplanung: Zeitraster 30 Min., Pufferzeit 5 Min. nach jedem Termin
  (änderbar im Admin-Bereich unter „Terminplanung“).
- Platzhaltertexte/-fotos für die Startseite (Über uns, Galerie) — im
  Admin-Bereich unter „Startseite“ durch echte Inhalte ersetzen. Die Adresse
  wird dort ebenfalls gepflegt, erscheint aber bewusst nicht auf der Website,
  sondern nur in der Terminbestätigungsmail.

## Terminplanung: Zeitraster, Pufferzeit, Dauer

Drei Stellschrauben steuern gemeinsam, welche Uhrzeiten Kunden angeboten
bekommen — alle im Admin-Bereich einstellbar, kein Code nötig:

- **Dauer pro Leistung** (Tab „Leistungen“): Wie lange der jeweilige
  Termin tatsächlich blockiert wird.
- **Zeitraster** (Tab „Terminplanung“): In welchem Abstand mögliche
  Startzeiten überhaupt angeboten werden (z.B. nur zur vollen und halben
  Stunde statt alle 15 Minuten).
- **Pufferzeit** (Tab „Terminplanung“): Zusätzliche Minuten, die nach
  jedem Termin automatisch freigehalten werden (Aufräumen, Luft zum
  Atmen) — der nächste Termin kann erst danach beginnen.

## E-Mail-Benachrichtigungen (optional)

Gibt ein Kunde bei der Buchung eine E-Mail-Adresse an, kann die App
automatisch eine Bestätigung verschicken (inkl. Ein-Klick-Buttons für Google/
Outlook/Yahoo-Kalender sowie einer angehängten `.ics`-Datei für Apple Kalender
& Co.) — und ihn informieren, falls der Termin storniert wird oder ein
Warteliste-Platz frei wird. Dafür in der `.env` (bzw. den
Netlify-Umgebungsvariablen) die `SMTP_*`-Variablen setzen (siehe
`.env.example`, funktioniert z.B. mit einem Gmail-App-Passwort oder einem
kostenlosen Anbieter wie Brevo). Ohne SMTP-Konfiguration läuft die App ganz
normal weiter, es werden dann einfach keine E-Mails verschickt.

Telefonnummer bleibt reine Kontaktinfo für Rückrufe — SMS-Benachrichtigung
würde einen zusätzlichen kostenpflichtigen Anbieter (z.B. Twilio)
erfordern und ist aktuell nicht eingebaut.

## Wie die Verfügbarkeit berechnet wird

Freie Termine ergeben sich automatisch aus: Öffnungszeiten des Wochentags,
minus bereits vergebener Termine, minus blockierter Zeiträume (Urlaub,
Pause). Es müssen keine Slots manuell angelegt werden — einfach
Öffnungszeiten pflegen, der Rest läuft von selbst.

## Projektstruktur

```
server.js                       Express-Server für lokale Entwicklung
netlify/functions/api.js        Gleiche API als Netlify Function für den Live-Betrieb
netlify.toml                    Netlify-Build-/Routing-Konfiguration
db.js                           Postgres-Verbindung (Supabase), Schema, Standarddaten
lib/availability.js             Berechnung freier Termine
lib/mailer.js                   E-Mail-Versand (optional, via SMTP)
lib/calendar.js                 Kalender-Links (Google/Outlook/Yahoo) + .ics-Datei fürs Attachment
lib/asyncHandler.js             Fehlerbehandlung für async Routen
routes/public.js                Öffentliche API (Leistungen, Verfügbarkeit, Buchen, Warteliste, Startseiten-Inhalte)
routes/admin.js                 Admin-API (Login, Termine, Öffnungszeiten, Warteliste, Leistungen, Startseiten-Inhalte)
middleware/auth.js              Login-Session (JWT in httpOnly-Cookie)
scripts/set-admin-password.js   Admin-Zugang anlegen/ändern (lokal oder live, gleiche DB)
public/index.html               Startseite (Vorstellung, Galerie, Infos)
public/buchen/                  Buchungsstrecke (Kunden-Frontend)
public/admin/                   Admin-Frontend (Login + Dashboard)
```
