# Changelog

## 0.5.0 – 2026-10-23

Suchen & Entdecken 🔭

### Neu

- **Playlists, Alben und Künstler in der Suche:** Die Suche zeigt neben Songs jetzt auch Playlists, Alben und Künstler von Spotify, YouTube Music und Amazon Music. Oben gibt es Reiter (*Alles · Songs · Playlists · Alben · Künstler*) und darunter die Auswahl der Dienste.
- **Top-Treffer:** Passt ein Künstler, eine Playlist oder ein Album genau zur Suche, steht er groß oben neben den Songs.
- **Abspielen direkt von der Kachel:** Fahr mit der Maus über eine Playlist oder ein Album und drück ▶ – Moonify startet sie beim jeweiligen Dienst.
- **Künstlerseiten** (Spotify & YouTube Music): beliebte Songs, Alben & Singles, Playlists und ähnliche Künstler. *Abspielen* und *Zufällig* inklusive.
- **Merken:** Playlists, Alben und Künstler der Dienste mit „Merken“ in Moonify ablegen – sie erscheinen in der Bibliothek, in der Seitenleiste und auf der Startseite.
- **Zurück:** Ein „Zurück“-Knopf auf Playlist- und Künstlerseiten führt dorthin, wo du herkamst (z. B. zurück zu den Suchergebnissen). Geht auch mit **Alt + ←** oder der Zurück-Taste der Maus.
- **Zuletzt gesucht:** Die letzten Suchbegriffe stehen auf der Suchseite – ein Klick sucht erneut.
- **In langen Listen suchen:** Playlists und Alben mit vielen Songs haben ein eigenes Suchfeld.

### Hinweise

- Bei Amazon Music kann Moonify die Songliste von Alben/Playlists und Künstlerseiten noch nicht anzeigen. „Abspielen“ startet das Album bzw. die Playlist trotzdem direkt bei Amazon, „Im Fenster öffnen“ zeigt die Seite im Amazon-Fenster.

## 0.4.0 – 2026-10-16

Songtexte zum Mitsingen 🎤

### Neu

- **Songtext-Knopf** in der Playerleiste (Mikrofon neben der Warteschlange). Er erscheint nur, wenn es zum laufenden Song einen Songtext gibt.
- **Mitlaufender Songtext:** Die Zeile, die gerade gesungen wird, leuchtet wie Mondlicht auf und die Ansicht scrollt mit. Ein Klick auf eine Zeile springt an diese Stelle im Song.
- Gibt es nur einen Songtext ohne Zeitangaben, wird er komplett angezeigt.
- Funktioniert für Spotify, YouTube Music und Amazon Music gleich. Zusätze wie „(Official Video)“ oder „- Remastered 2011“ werden für die Suche entfernt.

### Hinweise

- Die Songtexte kommen von [LRCLIB](https://lrclib.net), einer freien Songtext-Datenbank. Nicht jeder Song ist dort zu finden.
- Moonify schickt dafür nur Titel, Künstler und Länge des Songs an LRCLIB.

## 0.3.1 – 2026-10-16

### Behoben

- **Abgehackter Ton und springende Lautstärke:** Moonify hat die Lautstärke der Dienste zweimal pro Sekunde überschrieben. YouTube Music und Spotify gleichen ihre Lautstärke aber selbst an (eigener Regler, Lautstärkeausgleich zwischen Songs) und haben sie sofort zurückgestellt – dadurch sprang der Ton ständig zwischen leiser und lauter hin und her. Jetzt wirkt der Moonify-Regler als Faktor auf die Lautstärke des Dienstes, ohne gegeneinander zu arbeiten.
- **Stockender Ton im Hintergrund:** Die unsichtbaren Player-Fenster werden nicht mehr von Chromium gedrosselt.

Das Update kommt über *Einstellungen → Updates*.

## 0.3.0 – 2026-10-09

Musik speichern – für alle Dienste gemeinsam 💛

### Neu

- **Lieblingssongs:** Herz an jedem Song und in der Playerleiste. Funktioniert mit Spotify, YouTube Music und Amazon Music – auch ohne Anmeldung.
- **Eigene Playlists:** Anlegen, umbenennen, löschen, Songs hinzufügen, verschieben und entfernen. Songs aus verschiedenen Diensten lassen sich in einer Playlist mischen.
- **Ganze Playlists der Dienste übernehmen:** In einer Spotify- oder YouTube-Music-Playlist „In Moonify speichern“ wählen.
- **Warteschlange:** „Als Nächstes spielen“ und „Zur Warteschlange hinzufügen“ über das ⋯-Menü (oder Rechtsklick) bei jedem Song. Moonify spielt die Songs nacheinander ab – auch wenn sie von verschiedenen Diensten kommen. Vor/Zurück in der Playerleiste springt in der Warteschlange.
- **Abspielen & Zufällig** für Moonify-Playlists.
- **Zuletzt gehört:** Die letzten 50 Songs auf der Startseite und in der Bibliothek.
- **Seitenleiste** zeigt deine Playlists.
- **YouTube Music:** Der „Top-Treffer“ der Suche erscheint jetzt ebenfalls.

### Hinweise

- Gespeichertes liegt in Moonify auf deinem Computer – bei den Diensten selbst ändert sich nichts.
- Songs von Diensten, die gerade nicht verbunden sind, bleiben gespeichert und werden beim Abspielen übersprungen.
- Ab 0.2.0 kommt dieses Update über *Einstellungen → Updates*.

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
