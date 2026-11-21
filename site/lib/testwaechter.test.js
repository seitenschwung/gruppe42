'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const W = require('./testwaechter.js');

const { TEXTFELDER_TEST, TEXTFELDER_EINTRAG, struktur, pruefeStruktur, pruefeTexte } = W;
const DIR = path.join(__dirname, '..', 'kunden', 'gruppe42');
const IDS = ['antreiber', 'employer-branding', 'fuehrungsstil', 'teamklima'];
const lade = (id) => JSON.parse(fs.readFileSync(path.join(DIR, 'tests', id + '.json'), 'utf8'));
const meldungen = (d, S) => pruefeStruktur(d, S, TEXTFELDER_TEST);

function mit(id, fn) {
  const orig = lade(id);
  const d = structuredClone(orig);
  return fn(d, struktur(orig, TEXTFELDER_TEST), orig);
}

test('konstanten', () => {
  assert.deepStrictEqual(W.BETONT_ERLAUBT, ['result.title', 'motto']);
  assert.deepStrictEqual(W.GRENZEN, { kurz: 120, mittel: 400, lang: 1500 });
});

test('reine_textaenderung_ok', () => mit('teamklima', (d, S) => {
  d.questions[0].text = 'Neu';
  assert.deepStrictEqual(meldungen(d, S), []);
}));

test('reverse_geaendert', () => mit('teamklima', (d, S) => {
  d.questions[10].reverse = !d.questions[10].reverse;
  assert.match(meldungen(d, S).join(), /questions\[10\]\.reverse/);
}));

test('level_min_geaendert', () => mit('teamklima', (d, S) => {
  d.result.levels[1].min = 40;
  assert.match(meldungen(d, S).join(), /result\.levels\[1\]\.min/);
}));

test('kategorie_zuordnung', () => mit('teamklima', (d, S) => {
  d.questions[0].category = d.categories[1].id;
  assert.match(meldungen(d, S).join(), /questions\[0\]\.category/);
}));

test('fragen_reihenfolge', () => {
  mit('teamklima', (d, S) => {
    [d.questions[0], d.questions[1]] = [d.questions[1], d.questions[0]];
    assert.ok(meldungen(d, S).length >= 1);
  });
  mit('teamklima', (d, S) => {
    d.questions.splice(3, 1);
    const m = meldungen(d, S);
    assert.ok(m.length >= 1);
    assert.match(m.join(), /questions: Anzahl 19 statt 20/);
  });
});

test('neues_feld', () => mit('teamklima', (d, S) => {
  d.result.foo = 'x';
  assert.match(meldungen(d, S).join(), /result\.foo: unbekanntes Feld/);
}));

test('prototyp_namen_als_neue_schluessel', () => {
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    mit('teamklima', (d, S) => {
      d.result[name] = 'x';
      assert.match(meldungen(d, S).join(), new RegExp('result\\.' + name + ': unbekanntes Feld'), name);
    });
  }
});

test('eigener___proto___schluessel', () => mit('teamklima', (d, S) => {
  d.result = Object.assign(JSON.parse('{"__proto__":{"x":1}}'), d.result);
  assert.ok(Object.prototype.hasOwnProperty.call(d.result, '__proto__'));
  assert.match(meldungen(d, S).join(), /result\.__proto__: unbekanntes Feld/);
  const dd = JSON.parse(JSON.stringify(lade('teamklima')).replace('"result":{', '"result":{"__proto__":{"x":1},'));
  assert.match(meldungen(dd, S).join(), /result\.__proto__: unbekanntes Feld/);
}));

test('result_intro_grenze', () => mit('teamklima', (d) => {
  d.result.intro = 'a'.repeat(400);
  assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_TEST), []);
  d.result.intro = 'a'.repeat(401);
  assert.ok(pruefeTexte(d, TEXTFELDER_TEST).some((m) => m.pfad === 'result.intro'));
}));

test('cta_href_fest', () => {
  mit('antreiber', (d, S) => {
    d.result.cta.href = 'https://x';
    assert.match(meldungen(d, S).join(), /result\.cta\.href/);
  });
  mit('antreiber', (d, S) => {
    d.result.cta.text = 'Anderer Text';
    assert.deepStrictEqual(meldungen(d, S), []);
  });
});

test('platzhalter_im_abdruck', () => mit('antreiber', (d, S) => {
  assert.strictEqual(S.result.lead, '<text>{names}');
  assert.strictEqual(S.result.intro, '<text>');
}));

test('platzhalter_fehlt', () => mit('antreiber', (d, S) => {
  d.result.lead = 'Ohne Platzhalter.';
  assert.match(meldungen(d, S).join(), /result\.lead: Platzhalter \{names\} fehlt/);
}));

test('platzhalter_genau_einmal', () => mit('antreiber', (d, S) => {
  d.result.lead = 'Bei dir: {names}. Nochmal: {names}.';
  assert.match(meldungen(d, S).join(), /result\.lead: Platzhalter \{names\} mehrfach/);
  d.result.lead = 'Einmal {names} reicht.';
  assert.deepStrictEqual(meldungen(d, S), []);
  d.result.intro = 'Hier {names} und {names}';
  assert.match(meldungen(d, S).join(), /result\.intro: Platzhalter \{names\} unerwartet/);
}));

test('optionales_feld_hinzufuegen_ist_strukturaenderung', () => mit('teamklima', (d, S) => {
  d.categories[0].lowContext = 'Neu';
  assert.match(meldungen(d, S).join(), /categories\[0\]\.lowContext: unbekanntes Feld/);
}));

test('fehlendes_feld', () => mit('teamklima', (d, S) => {
  delete d.questions[2].category;
  assert.match(meldungen(d, S).join(), /questions\[2\]\.category: fehlt/);
}));

test('nicht_string_im_textfeld', () => mit('teamklima', (d, S) => {
  d.questions[0].text = 5;
  assert.match(meldungen(d, S).join(), /questions\[0\]\.text/);
  assert.ok(pruefeTexte(d, TEXTFELDER_TEST).some((m) => m.pfad === 'questions[0].text'));
}));

test('scale_texte_aenderbar', () => mit('teamklima', (d, S) => {
  d.scale['3'] = 'Mittel';
  assert.deepStrictEqual(meldungen(d, S), []);
  assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_TEST), []);
}));

test('leer', () => mit('teamklima', (d) => {
  d.questions[0].text = '  ';
  assert.ok(pruefeTexte(d, TEXTFELDER_TEST).some((m) => m.pfad === 'questions[0].text'));
}));

test('html_verboten', () => mit('teamklima', (d) => {
  d.questions[0].text = '<b>x</b>';
  assert.ok(pruefeTexte(d, TEXTFELDER_TEST).some((m) => m.pfad === 'questions[0].text' && /</.test(m.meldung)));
}));

test('betont_nur_titel', () => {
  mit('teamklima', (d) => {
    d.result.title = '*x* y';
    assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_TEST), []);
  });
  mit('teamklima', (d) => {
    d.questions[0].text = '*x*';
    assert.ok(pruefeTexte(d, TEXTFELDER_TEST).some((m) => m.pfad === 'questions[0].text'));
  });
});

test('link_verboten', () => mit('teamklima', (d) => {
  d.questions[0].text = 'Klick [hier](http://x)';
  assert.ok(pruefeTexte(d, TEXTFELDER_TEST).some((m) => m.pfad === 'questions[0].text'));
}));

test('zu_lang', () => mit('teamklima', (d) => {
  d.questions[0].text = 'a'.repeat(400);
  assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_TEST), []);
  d.questions[0].text = 'a'.repeat(401);
  assert.ok(pruefeTexte(d, TEXTFELDER_TEST).some((m) => m.pfad === 'questions[0].text'));
}));

test('alle_echten_ok', () => {
  for (const id of IDS) {
    const orig = lade(id);
    assert.deepStrictEqual(pruefeTexte(orig, TEXTFELDER_TEST), [], id);
    assert.deepStrictEqual(pruefeStruktur(orig, struktur(orig, TEXTFELDER_TEST), TEXTFELDER_TEST), [], id);
  }
});

test('struktur_ist_tiefe_kopie', () => {
  const orig = lade('teamklima');
  const kopie = structuredClone(orig);
  struktur(orig, TEXTFELDER_TEST);
  assert.deepStrictEqual(orig, kopie);
});

test('eintraege', () => {
  const g = JSON.parse(fs.readFileSync(path.join(DIR, 'gruppe42.json'), 'utf8'));
  const eintraege = g.tests.eintraege;
  assert.ok(eintraege.length >= 4);
  for (const e of eintraege) {
    const S = struktur(e, TEXTFELDER_EINTRAG);
    assert.deepStrictEqual(pruefeTexte(e, TEXTFELDER_EINTRAG), [], e.id);
    assert.deepStrictEqual(pruefeStruktur(e, S, TEXTFELDER_EINTRAG), [], e.id);
    for (const feld of ['id', 'daten', 'sichtbar']) {
      const d = structuredClone(e);
      d[feld] = feld === 'sichtbar' ? !e.sichtbar : 'x';
      assert.match(pruefeStruktur(d, S, TEXTFELDER_EINTRAG).join(), new RegExp(feld), feld);
    }
    const d = structuredClone(e);
    d.motto = 'Ein *neues* Motto';
    assert.deepStrictEqual(pruefeStruktur(d, S, TEXTFELDER_EINTRAG), []);
    assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_EINTRAG), []);
    d.titel = 'Mit *Stern*';
    assert.ok(pruefeTexte(d, TEXTFELDER_EINTRAG).some((m) => m.pfad === 'titel'));
  }
});

test('status_ohne_schlusspunkt', () => mit('teamklima', (d) => {
  d.status = 'Eigene Kurzbefragung.';
  const m = pruefeTexte(d, TEXTFELDER_TEST).filter((x) => x.pfad === 'status');
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].meldung, 'Bitte ohne Punkt am Ende – er wird automatisch ergänzt.');
  d.status = 'Eigene Kurzbefragung. ';
  assert.ok(pruefeTexte(d, TEXTFELDER_TEST).some((x) => x.pfad === 'status'));
  d.status = 'Eigene Kurzbefragung';
  assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_TEST), []);
  // nur status: andere Felder dürfen mit Punkt enden
  d.questions[0].text = 'Ein Satz.';
  assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_TEST), []);
}));

test('steuerzeichen_verboten', () => {
  const verboten = ['‪', '‮', '⁦', '⁩', '​', '‏', '﻿', '\u2028', '\u2029', '\u2060', '\u2064', '\u00AD', '\u061C'];
  for (const z of verboten) {
    mit('teamklima', (d) => {
      d.questions[0].text = 'Fra' + z + 'ge';
      const m = pruefeTexte(d, TEXTFELDER_TEST).filter((x) => x.pfad === 'questions[0].text');
      assert.strictEqual(m.length, 1, 'U+' + z.charCodeAt(0).toString(16));
      assert.strictEqual(m[0].meldung, 'Enthält unsichtbare Steuerzeichen – bitte Text neu eintippen.');
    });
  }
  // Grenzen: direkt daneben liegende Zeichen sind erlaubt
  for (const z of ['‧', ' ', '⁥', '⁪', ' ', '‐']) {
    mit('teamklima', (d) => {
      d.questions[0].text = 'Fra' + z + 'ge';
      assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_TEST), [], 'U+' + z.charCodeAt(0).toString(16));
    });
  }
  const g = JSON.parse(fs.readFileSync(path.join(DIR, 'gruppe42.json'), 'utf8'));
  const e = structuredClone(g.tests.eintraege[0]);
  e.titel = 'Ti​tel';
  assert.ok(pruefeTexte(e, TEXTFELDER_EINTRAG).some((x) => x.pfad === 'titel' && /Steuerzeichen/.test(x.meldung)));
});

test('steuerzeichen_c0_verboten', () => {
  const meldung = 'Enthält Zeilenumbrüche oder Steuerzeichen – bitte als eine Zeile schreiben.';
  for (const z of ['\u0000', '\t', '\n', '\r', '\u001B', '\u001F', '\u007F', '\u0085', '\u009F']) {
    mit('teamklima', (d) => {
      d.questions[0].text = 'Fra' + z + 'ge';
      const m = pruefeTexte(d, TEXTFELDER_TEST).filter((x) => x.pfad === 'questions[0].text');
      assert.deepStrictEqual(m.map((x) => x.meldung), [meldung], 'U+' + z.charCodeAt(0).toString(16));
    });
  }
  mit('teamklima', (d) => {
    d.questions[0].text = 'Frage mit Leerzeichen und Umlauten äöü – „Zitat“';
    assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_TEST), []);
  });
  const g = JSON.parse(fs.readFileSync(path.join(DIR, 'gruppe42.json'), 'utf8'));
  const e = structuredClone(g.tests.eintraege[0]);
  e.beschreibung = 'Zeile\nzwei';
  assert.ok(pruefeTexte(e, TEXTFELDER_EINTRAG).some((x) => x.pfad === 'beschreibung' && x.meldung === meldung));
});

test('fixture_ok', () => {
  const FIX = path.join(__dirname, '__fixtures__');
  const gf = JSON.parse(fs.readFileSync(path.join(FIX, 'gruppe42.json'), 'utf8'));
  for (const e of gf.tests.eintraege) {
    assert.deepStrictEqual(pruefeTexte(e, TEXTFELDER_EINTRAG), [], e.id);
    const d = JSON.parse(fs.readFileSync(path.join(FIX, e.daten), 'utf8'));
    assert.deepStrictEqual(pruefeTexte(d, TEXTFELDER_TEST), [], e.id);
  }
});
