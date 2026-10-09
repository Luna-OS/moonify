# 🌙 Moonify

**Spotify, YouTube Music und Amazon Music in einer App – unter einem Sternenhimmel.**

Moonify ist eine Desktop-App (Windows, macOS, Linux), mit der du Musik von deinen Diensten hörst,
ohne zwischen mehreren Apps oder Browser-Tabs zu wechseln.

![Moonify Startseite](docs/screenshot.png)

## Funktionen

- **Alles in Moonify:** Suche, Songs, Playlists und Lieblingssongs von Spotify, YouTube Music und
  Amazon Music erscheinen im eigenen Moonify-Design – keine Webseiten im Hauptfenster.
- **Nichts ist Pflicht:** Verbinde einen, zwei oder alle drei Dienste in den **Einstellungen**.
  Suche, Bibliothek und Seitenleiste zeigen nur die Dienste, die du verbunden hast.
- **Anmeldung im eigenen Fenster:** Beim Verbinden öffnet sich ein separates Browser-Fenster zum
  Anmelden (auch „Mit Apple/Google anmelden“). Danach schließt es sich und die Dienste laufen
  unsichtbar im Hintergrund.
- **Eine Suche für alles:** Ein Suchfeld (`Strg/⌘ + K`) durchsucht alle verbundenen Dienste
  gleichzeitig; Treffer werden gemischt angezeigt und lassen sich pro Dienst filtern.
- **Bibliothek:** Playlists und Lieblingssongs von Spotify und YouTube Music (Amazon folgt).
- **Speichern in Moonify:** Lieblingssongs (❤), eigene Playlists – auch gemischt aus mehreren
  Diensten – und „Zuletzt gehört“. Funktioniert für alle Dienste gleich, auch ohne Anmeldung.
- **Warteschlange:** „Als Nächstes spielen“ / „Zur Warteschlange hinzufügen“ über das ⋯-Menü;
  Moonify spielt die Songs nacheinander, auch über Dienste hinweg.
- **Eine Playerleiste für alle Dienste:** Titel, Künstler, Cover, Play/Pause, Vor/Zurück, Lautstärke.
- **Mond-Fortschrittsleiste:** Der Regler ist ein Mond, der mit dem Song wächst – von der schmalen
  Sichel am Anfang bis zum Vollmond am Ende. Bedienbar per Maus (klicken/ziehen) und Tastatur (← →).
- **Nie zwei Songs gleichzeitig:** Startest du Musik bei einem Dienst, pausieren die anderen automatisch.
- **Update-Button:** Unter *Einstellungen → Updates* holst du dir neue Versionen direkt in der App.
- **Sternenhimmel-Theme:** Animierte, funkelnde Sterne, Sternschnuppen, Nebel in Violett und Blau,
  Glas-Oberflächen und die **echte Mondphase von heute** auf der Startseite.

## Download

Fertige Installationsdateien für Windows, macOS und Linux gibt es unter
[**Releases**](https://github.com/Luna-OS/moonify/releases/latest).

## Aus dem Quellcode starten

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer.

```bash
npm install
npm start
```

Beim ersten Start öffnet sich die Startseite. Klicke bei den Diensten, die du nutzt, auf
**Verbinden** – es öffnet sich ein Anmeldefenster. Melde dich dort ganz normal an; Moonify erkennt die
Anmeldung, schließt das Fenster und merkt sich den Login.

### Installationsdatei bauen

```bash
npm run dist:win     # Windows-Installer (.exe)
npm run dist:mac     # macOS (.dmg)
npm run dist:linux   # Linux (AppImage + .deb)
```

Die fertigen Dateien liegen danach im Ordner `dist/`.

## Wie funktioniert das?

Für jeden verbundenen Dienst läuft im Hintergrund ein unsichtbares Fenster mit dessen **offiziellem
Web-Player** (`open.spotify.com`, `music.youtube.com`, `music.amazon.de`). Dadurch funktioniert alles,
was dein Abo hergibt, und du brauchst keine Entwickler-Zugänge oder API-Schlüssel.

Ein Skript in jedem dieser Player
- liest über die Media Session API aus, was gerade läuft, und führt die Befehle der Playerleiste aus,
- liest bei Suche und Bibliothek die Daten mit, die der Web-Player selbst lädt, und gibt sie an
  Moonify weiter, das sie im eigenen Design anzeigt,
- startet Songs, wenn du in Moonify auf einen Titel klickst.

Spotify und Amazon Music schützen ihre Musik mit Widevine-DRM. Deshalb nutzt Moonify die
[castLabs-Version von Electron](https://github.com/castlabs/electron-releases), die Widevine
enthält. Die Komponente wird beim ersten Start automatisch geladen.

**Google-Anmeldung:** Google blockiert Anmeldungen aus App-Fenstern, die sich als Chrome ausgeben.
Moonify schickt den Google-Anmeldeseiten deshalb seine echte App-Kennung. Zeigt Google trotzdem
„Anmeldung nicht möglich“, wechselt Moonify automatisch auf eine zweite Methode.

## Gut zu wissen

- **Spotify:** Der Web-Player funktioniert mit Free und Premium. Hörst du mit Spotify Free, gelten die
  üblichen Einschränkungen (Werbung, Shuffle).
- **Amazon Music:** Unter *Einstellungen* kannst du die Region einstellen (Standard:
  Deutschland/Österreich/Schweiz, `music.amazon.de`).
- **Lautstärke:** Der Moonify-Regler steuert die Lautstärke aller Dienste.
- **Medientasten** auf der Tastatur funktionieren ebenfalls, weil die Web-Player sie direkt unterstützen.
- **YouTube Music** kannst du auch ohne Anmeldung durchsuchen und hören.
- **Im Fenster öffnen:** Über die Einstellungen (oder einen Klick auf „über Spotify“ in der
  Playerleiste) kannst du den echten Web-Player eines Dienstes jederzeit in einem eigenen Fenster
  öffnen – z. B. für Einstellungen des Dienstes. Schließen versteckt das Fenster nur, die Musik läuft weiter.
- **Updates:** Windows und AppImage installieren Updates selbst beim Neustart; auf dem Mac und mit
  dem .deb-Paket lädt der Update-Button die neue Datei im Browser herunter.
- **Spielen Spotify oder Amazon im fertig gebauten Paket nicht ab?** Unter Windows und macOS
  verlangen manche Dienste ein *VMP-signiertes* Programm. Das lässt sich kostenlos mit dem
  [castLabs EVS](https://github.com/castlabs/electron-releases/wiki/EVS) erledigen
  (`python3 -m castlabs_evs.vmp sign-pkg dist/<plattform>-unpacked`).
- Moonify liest die Daten, die die Web-Player der Dienste selbst laden. Ändert ein Dienst etwas an
  seiner Webseite, kann einzelnes (z. B. Suche bei einem Dienst) kurz nicht funktionieren, bis Moonify
  angepasst ist. In dem Fall hilft „Im Fenster öffnen“.

## Entwicklung

### Neues Release

1. Version in `package.json` erhöhen (z. B. `npm version 0.2.0 --no-git-tag-version`).
2. Abschnitt `## 0.2.0 – Datum` in `CHANGELOG.md` ergänzen.
3. Nach dem Merge den Workflow *Release* unter *Actions* → *Run workflow* auf `main` starten
   (oder den Tag `v0.2.0` pushen). Er baut alle Installationsdateien, legt den Tag an und
   veröffentlicht das Release mit den Notizen aus dem Changelog.

### Tests

```bash
npm test        # Tests (Parser mit echten Beispieldaten, Mondphasen, Player-Logik, Updates …)
npm run check   # Syntax-Prüfung
```

```
src/
  main/          Electron-Hauptprozess, Sicherheitsregeln, Preload-Skripte
    main.js               Fenster, Sitzungen, Login-Popups, Abmelden
    engines.js            Unsichtbare Player-Fenster & Anmeldefenster
    updater.js            Update-Button (GitHub-Releases)
    preload.cjs           Brücke zur Oberfläche
    engine-preload.cjs    Steuert die Web-Player, liest Suche/Bibliothek mit
  renderer/      Oberfläche
    app.js                Start, Suche, Bibliothek, Einstellungen, Playerleiste
    styles.css            Sternenhimmel-Theme
    lib/moon.js           Mond-Zeichnung & echte Mondphase
    lib/moon-progress.js  Mond-Fortschrittsleiste
    lib/starfield.js      Animierter Sternenhimmel
    lib/player.js         Zusammenführung der Wiedergabe aller Dienste
    lib/library-store.js  Lieblingssongs, eigene Playlists, Verlauf
    lib/queue.js          Warteschlange & Erkennung des Song-Endes
  shared/providers.js     Anbieter-Definitionen
  shared/parsers.js       Macht aus den Daten der Dienste einheitliche Songs & Playlists
```

## Lizenz

MIT – siehe [LICENSE](LICENSE).

Spotify, YouTube Music und Amazon Music sind Marken ihrer jeweiligen Inhaber. Moonify ist ein
unabhängiges Projekt und steht in keiner Verbindung zu diesen Unternehmen.
