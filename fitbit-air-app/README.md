# Air Recovery: WHOOP-ähnliche App für die Fitbit Air

Web-App (installierbar als PWA auf dem Handy), die alle Daten deiner **Fitbit Air** aus deinem
Google-Health-Konto liest und daraus die drei Kernwerte im Stil von WHOOP berechnet:

| WHOOP | Hier | Grundlage |
|---|---|---|
| Recovery (0–100 %, grün/gelb/rot) | Erholung | HRV (55 %), Ruhepuls (20 %), Schlafleistung (20 %), Atemfrequenz (5 %), jeweils im Vergleich zu deiner persönlichen 30-Tage-Baseline |
| Day Strain (0–21) | Strain | Banister-TRIMP aus minütlicher Herzfrequenz (HF-Reserve), logarithmisch auf 0–21 skaliert; ohne HF-Daten aus Schritten geschätzt |
| Sleep Performance | Schlaf | Schlafdauer im Verhältnis zum Schlafbedarf (Basis + Belastung des Vortags + Schlafschuld − Nickerchen) |

Dazu kommen:

- **Coach**: Ziel-Strain je nach Recovery und empfohlene Schlafenszeit
- **Health Monitor**: Warnung bei erhöhter Hauttemperatur, Atemfrequenz, Ruhepuls oder niedriger SpO₂
- **Schlafdetails**: Hypnogramm, Tief-/REM-/Leichtschlaf, Effizienz, Konsistenz, Schlafschuld
- **Belastung**: Tagesverlauf der Herzfrequenz, Zeit in HF-Zonen, Schritte, Kalorien, Aktivzonenminuten
- **Trends** über 7/30/90 Tage (Recovery vs. Strain, SpO₂, Atemfrequenz, Hauttemperatur, Schritte)
- **Rohdaten**: Tabelle aller Tageswerte, Export als JSON/CSV, Import einer JSON-Sicherung
- **Demo-Modus** mit realistischen Beispieldaten, um alles ohne Konto auszuprobieren

Alle Gesundheitsdaten bleiben lokal im Browser (`localStorage`). Es gibt keinen eigenen Server.

> Die Formeln sind eigene, nachvollziehbare Näherungen (siehe `js/scoring.js`), nicht die
> proprietären WHOOP-Algorithmen. Die App ist kein Medizinprodukt.

## Datenquelle: Google Health API

Die Fitbit Air hat kein eigenes Display und wird über die **Google-Health-App** verwaltet. Google ersetzt
die alte Fitbit Web API durch die **Google Health API** (`https://health.googleapis.com/v4`); die Fitbit
Web API wird im Herbst 2026 abgeschaltet. Diese App nutzt deshalb ausschließlich die neue API.

Geladene Datentypen (`js/config.js`):

| Datentyp-ID | Verwendung |
|---|---|
| `heart-rate` | Strain, HF-Zonen, Tagesverlauf (minütlich gemittelt) |
| `daily-resting-heart-rate` | Recovery |
| `daily-heart-rate-variability` | Recovery |
| `sleep` | Schlafleistung, Phasen, Konsistenz |
| `steps`, `total-calories`, `active-zone-minutes` | Aktivität |
| `daily-oxygen-saturation`, `daily-respiratory-rate`, `daily-skin-temperature` | Health Monitor, Trends |

Falls Google einzelne IDs anders benennt, zeigt der Tab **Daten** an, welcher Typ fehlgeschlagen ist.
In den Einstellungen kannst du IDs dann per JSON umbenennen, z. B.
`{"daily-respiratory-rate": "respiratory-rate"}`. Auch die Scopes sind dort änderbar.

## Einrichtung (einmalig, ca. 10 Minuten)

1. **Google-Konto**: Deine Fitbit Air muss mit der Google-Health-App und einem Google-Konto verbunden sein.
2. **Google-Cloud-Projekt** anlegen: <https://console.cloud.google.com/>
3. **Google Health API aktivieren**: *APIs & Dienste → Bibliothek →* „Google Health API“.
4. **OAuth-Zustimmungsbildschirm** konfigurieren: Typ *Extern*, Status *Testen*, und dich selbst
   unter *Testnutzer* eintragen. Scopes hinzufügen:
   - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`

   Die Health-Scopes gelten als *eingeschränkt*. Für die private Nutzung als Testnutzer brauchst du
   keine Google-Prüfung; erst eine öffentliche Veröffentlichung erfordert sie.
5. **OAuth-Client-ID** erstellen: *Anmeldedaten → OAuth-Client-ID → Webanwendung*.
   Unter *Autorisierte JavaScript-Quellen* die Adresse eintragen, unter der die App läuft,
   z. B. `http://localhost:8080` (und später deine eigene Domain).
6. App starten (siehe unten), **⚙ Einstellungen** öffnen, Client-ID einfügen, Alter/Geschlecht eintragen,
   speichern und auf **⟳** tippen.

Die erste Synchronisation lädt Tageswerte der letzten 30 Tage und die detaillierte Herzfrequenz der letzten
7 Tage. Danach wird nur noch inkrementell nachgeladen, sodass sich die Historie mit der Zeit aufbaut.
Die persönliche Baseline steht ab 4 Tagen Daten, voll aussagekräftig ist sie nach etwa 2 Wochen.

## Starten

```bash
cd fitbit-air-app
npm start          # statischer Server auf http://localhost:8080 (Python 3)
npm test           # Tests der Berechnungen und der Datenumwandlung (Node ≥ 20)
```

### Auf dem iPhone

1. Den Ordner `fitbit-air-app/` über **HTTPS** hosten, z. B. mit GitHub Pages oder Netlify.
   Google erlaubt die Anmeldung nur über HTTPS (Ausnahme: `localhost`).
2. Die Adresse (z. B. `https://<name>.github.io`) in der OAuth-Client-ID unter
   *Autorisierte JavaScript-Quellen* eintragen.
3. Die Adresse in **Safari** öffnen, dann **Teilen → Zum Home-Bildschirm**.
4. Die App immer über das Symbol auf dem Home-Bildschirm starten. Nur dort bleiben die lokal
   gespeicherten Daten dauerhaft erhalten; Safari-Tabs löscht iOS nach längerer Nichtnutzung.

## Aufbau

```
fitbit-air-app/
├── index.html            # Oberfläche (Heute, Erholung, Strain, Schlaf, Trends, Daten)
├── styles.css
├── manifest.webmanifest  # PWA
├── sw.js                 # Offline-Cache der App-Dateien
├── js/
│   ├── config.js         # API-Basis, Scopes, Datentypen, Standardeinstellungen
│   ├── auth.js           # Google OAuth 2.0 (Google Identity Services, Token-Flow)
│   ├── api.js            # Laden mit Paginierung, Filtern, inkrementeller Sync
│   ├── normalize.js      # API-Datenpunkte → Tagesdatensätze (tolerant gegenüber Schemaänderungen)
│   ├── scoring.js        # Recovery, Strain, Schlafbedarf, Konsistenz, Coach
│   ├── charts.js         # SVG-Diagramme ohne Abhängigkeiten
│   ├── store.js          # lokale Speicherung
│   ├── demo.js           # Beispieldaten
│   └── main.js           # App-Logik und Rendering
└── test/scoring.test.js
```
