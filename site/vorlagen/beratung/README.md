# Vorlage „beratung“

Website für Beratung, Training und Coaching – klar, warm, professionell. Erste Kundin: Gruppe 42
(`kunden/gruppe42/gruppe42.json`). Inhaltsschema: `schemas/beratung.schema.json`.

## Seiten

- `index.html` – Hero mit großem Bild, Zahlen, Referenzen, Haltung, Geschichte (Zeitleiste), Leistungen,
  Zielgruppen, Ablauf, Stimmen, Person, Kontaktband
- `<id>.html` je Eintrag in `zielgruppen[]` – Workshops mit Filter nach `kategorie` (ohne JavaScript alle sichtbar),
  optional `foerderung`, Rahmen (`rahmen[]`) und `stimme`
- `<id>.html` je Leistung mit `abschnitte` – sonst verlinkt die Karte auf `link` (z. B. `#zielgruppen`)
- `impressum.html`, `datenschutz.html` (Markdown; Bildnachweise aus `credit` erscheinen im Impressum)

## Hinweise

- `*Wort*` in Titeln wird kursiv in Terrakotta hervorgehoben.
- Name mit Zahl am Ende (z. B. „Gruppe 42“) wird als Wortmarke mit runder Zahl gesetzt.
- Bilder der Vorlage (`images/`) sind Unsplash-Fotos (lizenzfrei, Nachweis über `credit`); Kundenfotos wie
  das Porträt liegen im Objektspeicher (`kunden/<ordner>/images/`).
- Schriften Newsreader und Figtree liegen in `fonts/` (SIL OFL, Lizenztexte daneben).
- `demo_modus: true` → noindex und Hinweisleiste „Entwurf“.

Einzeln bauen: `node build.js ../../kunden/gruppe42/gruppe42.json` → `dist/`
