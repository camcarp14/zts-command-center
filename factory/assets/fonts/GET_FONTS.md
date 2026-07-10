# Fonts

Captions and pop-up text need a bold TTF here. Recommended (free, SIL OFL):

1. Download **Montserrat ExtraBold** from Google Fonts (fonts.google.com/specimen/Montserrat)
2. Copy `Montserrat-ExtraBold.ttf` into this folder.
3. Confirm `captions.font` in `config/settings.yaml` matches the font's *family name*
   ("Montserrat ExtraBold"). If ffmpeg logs "font not found", the family name is off --
   run `fc-scan Montserrat-ExtraBold.ttf | grep family` (Linux/macOS) to see the real name.

Anything bold and geometric works (Archivo Black, Inter Black). Avoid thin fonts --
Shorts captions live or die on glanceability.
