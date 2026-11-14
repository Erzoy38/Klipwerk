# Klipwerk

Kostenloser Video-Editor für Windows mit lokalen KI-Funktionen. Kein Konto, kein Abo, kein Wasserzeichen – alles läuft auf dem eigenen PC.

## Starten

**Fertige Version (`Klipwerk-1.0.0-win.zip`):** ZIP entpacken und `Klipwerk.exe` starten. Windows zeigt beim ersten Start eventuell „Der Computer wurde durch Windows geschützt“ – dann „Weitere Informationen → Trotzdem ausführen“ (die App ist nicht signiert).

**Aus dem Quellcode:**

1. [Node.js LTS](https://nodejs.org) installieren.
2. `Installieren.bat` doppelklicken (lädt einmalig die Abhängigkeiten).
3. `Starten.bat` doppelklicken.

**Automatisch auf GitHub bauen:** im Repository unter „Actions“ → „Windows-Version bauen“ → „Run workflow“. Nach einigen Minuten liegt die fertige EXE unter „Releases“.

Mit `EXE-erstellen.bat` entsteht im Ordner `dist` ein Installationsprogramm und eine portable EXE.

## Funktionen

- **Timeline:** mehrere Video-, Audio- und Textspuren; Clips verschieben, trimmen, teilen, duplizieren, kopieren/einfügen; Löschen mit Lückenschluss; Einrasten; Zoom; Rückgängig/Wiederholen; Wellenformen
- **Medien:** Videos, Bilder, Audio (nicht abspielbare Formate wie HEVC/MKV/AVI werden automatisch umgewandelt)
- **Keyframes:** Position, Größe, Drehung und Deckkraft über die Zeit animieren
- **Zuschnitt und Masken:** Ränder beschneiden; Masken abgerundet, Kreis, Quadrat, Herz
- **Greenscreen:** Schlüsselfarbe frei wählbar, mit Toleranz und weicher Kante
- **Mischmodi:** Screen, Addieren, Multiplizieren, Überlagern und weitere
- **Text und Sticker:** 9 Stilvorlagen, 30 Sticker, 12 Formen; Schrift, Kontur, Hintergrund, Schatten
- **Filter:** 14 Farbfilter plus Helligkeit, Kontrast, Sättigung, Farbton, Weichzeichner
- **FX-Effekte:** RGB-Split, Glitch, VHS, Pixel, Vignette, Filmkorn, Glow, Spiegel, Kino-Balken, Blitz, Wackeln, Zoom-Puls, Sanfter Zoom, Regenbogen
- **Animationen:** 12 Ein- und 10 Ausblend-Animationen (auch als Übergänge nutzbar)
- **Clip-Werkzeuge:** Standbild, Rückwärts, Ton abtrennen, Pausen automatisch entfernen, Tempo, Lautstärke, Ein-/Ausblenden
- **Ton:** Sprachaufnahme über das Mikrofon; Stimmeffekte (tief, hoch, Roboter, Echo, Halle, Telefon, Funkgerät)
- **Formate:** 16:9, 9:16, 1:1, 4:5, 4:3
- **Export:** MP4 (H.264 + AAC), GIF, nur Ton (MP3/WAV), Einzelbild (PNG), Untertitel (SRT) – ohne Wasserzeichen
- **Automatische Sicherung:** alle 30 Sekunden, Wiederherstellung beim nächsten Start

### KI-Funktionen (Reiter „KI“)

| Funktion | Technik | Internet nötig? |
|---|---|---|
| Auto-Untertitel (auch mit Übersetzung ins Englische) | Whisper (läuft lokal) | nur beim ersten Mal, um das Sprachmodell zu laden (40–250 MB) |
| Person im Bild halten (Auto-Reframe) | MediaPipe-Personensegmentierung | nein |
| Hintergrund entfernen | MediaPipe-Personensegmentierung | nein, Modell liegt bei |
| Text-zu-Sprache | Windows-Sprachausgabe | nein |
| Audio verbessern und Stimmeffekte | FFmpeg-Filter | nein |

Weitere Stimmen für Text-zu-Sprache: Windows-Einstellungen → Zeit und Sprache → Sprachausgabe.

Sprachmodelle komplett offline nutzen: Modellordner nach `assets/models/Xenova/whisper-base` (bzw. `-tiny`, `-small`) kopieren.

## Tastenkürzel

| Taste | Aktion |
|---|---|
| Leertaste | Wiedergabe / Pause |
| S oder Strg+B | Clip am Abspielkopf teilen |
| Entf | Clip löschen |
| Umschalt+Entf | Löschen und Lücke schließen |
| K | Keyframe setzen / entfernen |
| Strg+C / Strg+V | Clip kopieren / einfügen |
| Strg+D | Duplizieren |
| Strg+Z / Strg+Y | Rückgängig / Wiederholen |
| ← / → (mit Umschalt: 10 Bilder) | Bild zurück / vor |
| Strg+Mausrad | Timeline zoomen |
| Strg+S / Strg+O | Projekt speichern / öffnen |

## Aufbau

- `main.js` – Electron-Hauptprozess: Dateien, FFmpeg, Sprachausgabe, Export
- `src/render.js`, `src/effects.js` – Bildberechnung (Vorschau und Export nutzen denselben Code)
- `src/player.js`, `src/timeline.js`, `src/inspector.js`, `src/panels.js` – Oberfläche
- `src/tools.js`, `src/chroma.js`, `src/waveform.js` – Schnittwerkzeuge, Greenscreen, Wellenformen
- `src/ai/` – Untertitel (Whisper), Hintergrundentfernung (MediaPipe)

## Grenzen

- Der Export berechnet jedes Bild einzeln und ist deshalb langsamer als Echtzeit.
- Hintergrund entfernen erkennt Personen, keine beliebigen Objekte.
- KI-Funktionen, die große Server-Modelle brauchen (Video aus Text erzeugen, KI-Avatare), sind nicht enthalten.

## Lizenz und Copyright

Copyright © 2026 Erzoy38. Veröffentlicht unter der MIT-Lizenz, siehe [LICENSE](LICENSE).

Klipwerk nutzt Open-Source-Komponenten mit eigenen Lizenzen: Electron, FFmpeg (über `ffmpeg-static`, GPL), Transformers.js mit Whisper-Modellen und MediaPipe.
