# Klipwerk

Kostenloser Video-Editor für Windows mit lokalen KI-Funktionen. Kein Konto, kein Abo, kein Wasserzeichen – alles läuft auf dem eigenen PC.

## Starten

**Fertige Version (`Klipwerk-1.0.0-win.zip`):** ZIP entpacken und `Klipwerk.exe` starten. Windows zeigt beim ersten Start eventuell „Der Computer wurde durch Windows geschützt“ – dann „Weitere Informationen → Trotzdem ausführen“ (die App ist nicht signiert).

**Aus dem Quellcode:**

1. [Node.js LTS](https://nodejs.org) installieren.
2. `Installieren.bat` doppelklicken (lädt einmalig die Abhängigkeiten).
3. `Starten.bat` doppelklicken.

Mit `EXE-erstellen.bat` entsteht im Ordner `dist` ein Installationsprogramm und eine portable EXE.

## Funktionen

- **Timeline:** mehrere Video-, Audio- und Textspuren; Clips verschieben, trimmen, teilen, duplizieren; Einrasten; Zoom; Rückgängig/Wiederholen
- **Medien:** Videos, Bilder, Audio (nicht abspielbare Formate wie HEVC/MKV/AVI werden automatisch umgewandelt)
- **Text:** 9 Stilvorlagen, Schrift, Kontur, Hintergrund, Schatten
- **Filter:** 14 Farbfilter plus Helligkeit, Kontrast, Sättigung, Farbton, Weichzeichner
- **FX-Effekte:** RGB-Split, Glitch, VHS, Pixel, Vignette, Filmkorn, Glow, Spiegel, Kino-Balken, Blitz, Wackeln, Zoom-Puls, Sanfter Zoom, Regenbogen
- **Animationen:** 12 Ein- und 10 Ausblend-Animationen (auch als Übergänge nutzbar)
- **Tempo, Lautstärke, Ein-/Ausblenden** je Clip
- **Formate:** 16:9, 9:16, 1:1, 4:5, 4:3
- **Export:** MP4 (H.264 + AAC), ohne Wasserzeichen

### KI-Funktionen (Reiter „KI“)

| Funktion | Technik | Internet nötig? |
|---|---|---|
| Auto-Untertitel | Whisper (läuft lokal) | nur beim ersten Mal, um das Sprachmodell zu laden (40–250 MB) |
| Hintergrund entfernen | MediaPipe-Personensegmentierung | nein, Modell liegt bei |
| Text-zu-Sprache | Windows-Sprachausgabe | nein |
| Audio verbessern | FFmpeg-Rauschfilter und Kompressor | nein |

Weitere Stimmen für Text-zu-Sprache: Windows-Einstellungen → Zeit und Sprache → Sprachausgabe.

Sprachmodelle komplett offline nutzen: Modellordner nach `assets/models/Xenova/whisper-base` (bzw. `-tiny`, `-small`) kopieren.

## Tastenkürzel

| Taste | Aktion |
|---|---|
| Leertaste | Wiedergabe / Pause |
| S oder Strg+B | Clip am Abspielkopf teilen |
| Entf | Clip löschen |
| Strg+D | Duplizieren |
| Strg+Z / Strg+Y | Rückgängig / Wiederholen |
| ← / → (mit Umschalt: 10 Bilder) | Bild zurück / vor |
| Strg+Mausrad | Timeline zoomen |
| Strg+S / Strg+O | Projekt speichern / öffnen |

## Aufbau

- `main.js` – Electron-Hauptprozess: Dateien, FFmpeg, Sprachausgabe, Export
- `src/render.js`, `src/effects.js` – Bildberechnung (Vorschau und Export nutzen denselben Code)
- `src/player.js`, `src/timeline.js`, `src/inspector.js`, `src/panels.js` – Oberfläche
- `src/ai/` – Untertitel (Whisper), Hintergrundentfernung (MediaPipe)

## Grenzen

- Der Export berechnet jedes Bild einzeln und ist deshalb langsamer als Echtzeit.
- Hintergrund entfernen erkennt Personen, keine beliebigen Objekte.
- KI-Funktionen, die große Server-Modelle brauchen (Video aus Text erzeugen, KI-Avatare), sind nicht enthalten.
