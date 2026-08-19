# Funky Cuts — Online-Terminbuchung 💈

Einfache Terminbuchungs-Website für einen Friseursalon: Kunden buchen sich
selbst einen Termin, der Salon-Betreiber verwaltet Öffnungszeiten, Pausen
und Leistungen über einen eigenen Admin-Bereich.

- **Kunden:** `/` — Leistung wählen → Tag wählen → Uhrzeit wählen → Kontaktdaten → fertig.
- **Admin:** `/admin` — Login, Termine einsehen/stornieren, Öffnungszeiten
  einstellen, Tage blockieren (Urlaub, Pause), Leistungen verwalten.

Kein Build-Schritt nötig, ein Node-Prozess bedient Frontend + API, Daten
liegen in einer lokalen SQLite-Datei.

## 1. Lokal einrichten

Voraussetzung: [Node.js](https://nodejs.org/) Version 18 oder neuer.

```bash
npm install
```

`.env`-Datei anlegen (Kopie von `.env.example`):

```bash
cp .env.example .env
```

In der `.env` den `JWT_SECRET` durch einen eigenen Zufallswert ersetzen, z.B. erzeugen mit:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 2. Admin-Zugang anlegen

Einmalig einen Benutzernamen + Passwort für den Admin-Bereich vergeben:

```bash
npm run set-admin-password -- funky geheimespasswort123
```

(Benutzername und Passwort frei wählbar, Passwort mind. 6 Zeichen. Das
Kommando kann jederzeit erneut ausgeführt werden, um das Passwort zu ändern.)

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

## Standard-Daten beim ersten Start

Beim allerersten Start werden automatisch angelegt:

- Öffnungszeiten: Mo–Fr 09:00–18:00, Sa 09:00–14:00, So geschlossen
  (änderbar im Admin-Bereich unter „Öffnungszeiten“).
- Vier Beispiel-Leistungen (Herrenhaarschnitt, Waschen/Schneiden/Föhnen,
  Bart trimmen, Komplettpaket) — im Admin-Bereich unter „Leistungen“
  anpassen, deaktivieren oder neue hinzufügen.
- Terminplanung: Zeitraster 30 Min., Pufferzeit 5 Min. nach jedem Termin
  (änderbar im Admin-Bereich unter „Terminplanung“).

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
automatisch eine Bestätigung verschicken — und ihn informieren, falls der
Termin storniert wird. Dafür in der `.env` die `SMTP_*`-Variablen setzen
(siehe `.env.example`, funktioniert z.B. mit einem Gmail-App-Passwort oder
einem kostenlosen Anbieter wie Brevo). Ohne SMTP-Konfiguration läuft die
App ganz normal weiter, es werden dann einfach keine E-Mails verschickt.

Telefonnummer bleibt reine Kontaktinfo für Rückrufe — SMS-Benachrichtigung
würde einen zusätzlichen kostenpflichtigen Anbieter (z.B. Twilio)
erfordern und ist aktuell nicht eingebaut.

## Wie die Verfügbarkeit berechnet wird

Freie Termine ergeben sich automatisch aus: Öffnungszeiten des Wochentags,
minus bereits vergebener Termine, minus blockierter Zeiträume (Urlaub,
Pause). Es müssen keine Slots manuell angelegt werden — einfach
Öffnungszeiten pflegen, der Rest läuft von selbst.

## Deployment (die Seite online stellen, damit jeder zugreifen kann)

Diese App ist bewusst so gebaut, dass sie sich 1:1 auf einen kostenlosen
Hosting-Anbieter (z.B. [Render](https://render.com) oder
[Railway](https://railway.app)) deployen lässt:

1. Projekt in ein (privates) GitHub-Repository pushen.
2. Bei Render/Railway einen neuen „Web Service“ aus dem Repo erstellen.
3. Start-Befehl: `npm start`, Build-Befehl: `npm install`.
4. Umgebungsvariablen aus `.env` dort als „Environment Variables“ eintragen
   (`JWT_SECRET`, `SALON_NAME`, `TZ=Europe/Berlin`).
5. Nach dem ersten Deploy einmalig per Konsole/Shell des Anbieters
   `npm run set-admin-password -- <benutzer> <passwort>` ausführen.

Wichtig: Die SQLite-Datenbank liegt als Datei im `data/`-Ordner. Manche
kostenlose Hosting-Tarife setzen das Dateisystem bei jedem Neustart/Deploy
zurück — dann gehen gespeicherte Termine verloren. Für dauerhaften Betrieb
entweder einen Tarif mit „Persistent Disk“ wählen, oder gemeinsam beim
Live-Schalten kurz draufschauen, dann helfe ich beim Umstieg auf eine
extern gehostete Datenbank.

## Projektstruktur

```
server.js              Express-Server, bindet Routen + statische Dateien
db.js                   SQLite-Setup, Schema, Standarddaten
lib/availability.js     Berechnung freier Termine
routes/public.js        Öffentliche API (Leistungen, Verfügbarkeit, Buchen)
routes/admin.js         Admin-API (Login, Termine, Öffnungszeiten, Leistungen)
middleware/auth.js       Login-Session (JWT in httpOnly-Cookie)
scripts/set-admin-password.js   Admin-Zugang anlegen/ändern
public/                 Kunden-Frontend (index.html, css/, js/)
public/admin/           Admin-Frontend (Login + Dashboard)
data/booking.db         SQLite-Datenbankdatei (wird automatisch angelegt)
```
