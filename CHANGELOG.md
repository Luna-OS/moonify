# Changelog

## 0.2.0 – 2026-10-06

Moonify zeigt deine Musik jetzt im eigenen Sternen-Design statt der Webseiten der Dienste 🌙

### Neu

- **Eigene Suche für alle Dienste:** Ergebnisse von Spotify, YouTube Music und Amazon Music erscheinen gemischt in einer Liste – mit Cover, Künstler, Album und Dauer. Filter pro Dienst per Klick.
- **Bibliothek:** Deine Playlists und Lieblingssongs von Spotify und YouTube Music, direkt in Moonify. Playlists öffnen und abspielen.
- **Anmelden in einem eigenen Fenster:** In den Einstellungen verbindest du die Dienste. Die Anmeldung öffnet sich in einem separaten Browser-Fenster – im Hauptfenster siehst du nur noch Moonify. Die Dienste laufen unsichtbar im Hintergrund.
- **Google-Anmeldung repariert:** Moonify meldet sich bei Google mit der echten App-Kennung an. Lehnt Google trotzdem ab („Anmeldung nicht möglich“), versucht Moonify automatisch eine zweite Methode.
- **Update-Button:** In den Einstellungen unter *Updates* prüfst du mit einem Klick auf neue Versionen. Unter Windows und mit dem AppImage wird das Update automatisch geladen und beim Neustart installiert; auf dem Mac und mit dem .deb-Paket lädst du es im Browser herunter.
- **Einstellungen** statt „Anbieter verwalten“, mit Status, Anmelden, „Im Fenster öffnen“ und Trennen pro Dienst.

### Hinweise

- **Von 0.1.0 auf 0.2.0** einmal manuell aktualisieren (Datei unten herunterladen). Ab 0.2.0 geht es dann über den Update-Button.
- YouTube Music lässt sich auch ohne Anmeldung durchsuchen und abspielen.
- Die Bibliothek von Amazon Music kann Moonify noch nicht anzeigen – Suchen und Abspielen klappt.
- Moonify liest dafür die Daten, die die Web-Player der Dienste selbst laden. Ändert ein Dienst seine Webseite, kann einzelnes kurz nicht funktionieren, bis Moonify angepasst ist.

### Download

| System | Datei |
| --- | --- |
| Windows | `Moonify-0.2.0-win-x64.exe` |
| macOS (Apple Silicon) | `Moonify-0.2.0-mac-arm64.dmg` |
| Linux | `Moonify-0.2.0-linux-x86_64.AppImage` oder `Moonify-0.2.0-linux-amd64.deb` |

Die App ist noch nicht signiert: Unter Windows *Weitere Informationen* → *Trotzdem ausführen*, auf dem Mac Rechtsklick → *Öffnen*.

## 0.1.0 – 2026-10-04

Die erste Version von Moonify 🌙

### Neu

- **Spotify, YouTube Music und Amazon Music in einer App.** Kein Anbieter ist Pflicht – Moonify zeigt nur die Dienste, mit denen du dich verbindest.
- **Gemeinsame Playerleiste** mit Titel, Cover, Play/Pause, Vor/Zurück und Lautstärke für alle Dienste.
- **Mond-Fortschrittsleiste:** Der Regler ist ein Mond, der mit dem Song von der Sichel zum Vollmond wächst.
- **Eine Suche für alle Dienste** (`Strg/⌘ + K`), mit Tabs pro Anbieter.
- **Automatisches Pausieren:** Startet ein Dienst, pausieren die anderen.
- **Sternenhimmel-Design** mit funkelnden Sternen, Sternschnuppen und der echten Mondphase von heute.
- **Getrennte Logins** pro Anbieter – ausblenden oder komplett abmelden.

### Download

| System | Datei |
| --- | --- |
| Windows | `Moonify-0.1.0-win-x64.exe` |
| macOS (Apple Silicon) | `Moonify-0.1.0-mac-arm64.dmg` |
| Linux | `Moonify-0.1.0-linux-x86_64.AppImage` oder `Moonify-0.1.0-linux-amd64.deb` |

### Hinweise zur Installation

- Die App ist noch nicht mit einem Entwickler-Zertifikat signiert.
  - **Windows:** Bei „Der Computer wurde durch Windows geschützt“ auf *Weitere Informationen* → *Trotzdem ausführen* klicken.
  - **macOS:** Die App per Rechtsklick → *Öffnen* starten. Falls macOS sie trotzdem blockiert: *Systemeinstellungen* → *Datenschutz & Sicherheit* → *Dennoch öffnen*.
- Falls Spotify oder Amazon Music nicht abspielen: Diese Dienste verlangen unter Windows/macOS teilweise eine zusätzliche Widevine-Signatur (VMP), die in dieser Version noch fehlt. YouTube Music ist davon nicht betroffen.
