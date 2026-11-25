#!/bin/sh
# Přegeneruje podklady ke stažení do public/podklady/ (CV a reference z HTML přes Chrome, vCard)
# a náhled odkazu public/og.png z og.html.
# Spouštět po změně cv.html, reference.html, og.html nebo kontaktů: sh web/podklady/vyrob.sh
set -eu

here=$(cd "$(dirname "$0")" && pwd)
out="$here/../public/podklady"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p "$out"

for name in cv reference; do
  "$chrome" --headless=new --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="$out/dan-hromada-$name.pdf" "file://$here/$name.html" 2>/dev/null
done

# Náhled odkazu fakan.cz (og:image) 1200 × 630, iMessage a spol. SVG neumí
"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --screenshot="$here/../public/og.png" "file://$here/og.html" 2>/dev/null

# vCard 3.0, řádky musí končit CRLF
printf '%s\r\n' \
  'BEGIN:VCARD' \
  'VERSION:3.0' \
  'N:Hromada;Dan;;;' \
  'FN:Dan Hromada' \
  'ORG:Indigo Studio s.r.o.' \
  'TITLE:CEO' \
  'EMAIL;TYPE=INTERNET,WORK:daniel@indigostudio.cz' \
  'TEL;TYPE=CELL,VOICE:+420604690539' \
  'ADR;TYPE=WORK:;;Chudenická 1059/30;Praha;;102 00;Česko' \
  'URL:https://fakan.cz' \
  'item1.URL:https://indigostudio.cz' \
  'item1.X-ABLabel:Indigo Studio' \
  'END:VCARD' > "$out/dan-hromada.vcf"

ls -l "$out"
