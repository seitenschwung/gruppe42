// GitHub-Zugriff für den Test-Editor (REST, Git-Data-API). Ohne DOM, ohne Node-APIs; fetch kommt über ctx.fetch.
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EditorGithub = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://api.github.com';

  function fehler(art, text, status) {
    const e = new Error(text || art);
    e.art = art;
    if (status !== undefined) e.status = status;
    return e;
  }

  // Ruft die API auf; parst JSON. konfliktStati: Statuscodes, die als 'konflikt' gelten.
  async function anfrage(ctx, methode, pfad, body, konfliktStati) {
    const opt = {
      method: methode,
      headers: {
        Authorization: 'Bearer ' + ctx.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    let antwort;
    try {
      antwort = await ctx.fetch(API + pfad, opt);
    } catch (e) {
      throw fehler('netz', 'Keine Verbindung zu GitHub');
    }
    if (antwort.status === 401) throw fehler('abgelaufen', 'Anmeldung abgelaufen', 401);
    if (konfliktStati && konfliktStati.includes(antwort.status)) throw fehler('konflikt', 'Konflikt', antwort.status);
    if (!antwort.ok) throw fehler('fehler', 'GitHub-Fehler ' + antwort.status, antwort.status);
    try {
      return await antwort.json();
    } catch (e) {
      throw fehler('fehler', 'Ungültige Antwort von GitHub', antwort.status);
    }
  }

  const zuBase64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const vonBase64 = (b64) => {
    const s = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  };
  const pfadKodiert = (p) => p.split('/').map(encodeURIComponent).join('/');
  const zweistellig = (n) => String(n).padStart(2, '0');

  function zeitstempel(d) {
    return d.getFullYear() + '-' + zweistellig(d.getMonth() + 1) + '-' + zweistellig(d.getDate()) +
      '-' + zweistellig(d.getHours()) + zweistellig(d.getMinutes());
  }

  // Aktueller Commit eines Branches (zum Lesen eines festen Stands und als eingabe.erwartet für sende).
  async function kopf(ctx, branch) {
    const ref = await anfrage(ctx, 'GET', '/repos/' + ctx.repo + '/git/ref/heads/' + pfadKodiert(branch));
    return ref.object.sha;
  }

  async function zugriff(ctx) {
    const nutzer = await anfrage(ctx, 'GET', '/user');
    const repo = await anfrage(ctx, 'GET', '/repos/' + ctx.repo);
    return { login: nutzer.login, darfSchreiben: !!(repo.permissions && repo.permissions.push) };
  }

  async function ladeDatei(ctx, pfad, ref) {
    const q = ref ? '?ref=' + encodeURIComponent(ref) : '';
    const d = await anfrage(ctx, 'GET', '/repos/' + ctx.repo + '/contents/' + pfadKodiert(pfad) + q);
    return { text: vonBase64(d.content), sha: d.sha };
  }

  async function offenerPr(ctx, testId) {
    const liste = await anfrage(ctx, 'GET', '/repos/' + ctx.repo + '/pulls?state=open&per_page=100');
    const muster = new RegExp('^inhalt/' + testId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d{4}-\\d{2}-\\d{2}-\\d{4}$');
    const pr = liste.find((p) => p.head && typeof p.head.ref === 'string' && muster.test(p.head.ref) &&
      p.head.repo && p.head.repo.full_name === ctx.repo);
    return pr ? { nummer: pr.number, branch: pr.head.ref, url: pr.html_url } : null;
  }

  async function sende(ctx, eingabe) {
    const r = '/repos/' + ctx.repo;
    const jetzt = ctx.jetzt || (() => new Date());
    const branch = eingabe.pr ? eingabe.pr.branch : 'inhalt/' + eingabe.testId + '-' + zeitstempel(jetzt());
    const quelle = eingabe.pr ? eingabe.pr.branch : ctx.basis;

    const ref = await anfrage(ctx, 'GET', r + '/git/ref/heads/' + pfadKodiert(quelle));
    const kopf = ref.object.sha;
    // Dateien wurden von diesem Stand gelesen: hat sich der Branch seither bewegt, nicht darüber schreiben.
    if (eingabe.erwartet && eingabe.erwartet !== kopf) throw fehler('konflikt', 'Stand hat sich geändert');
    const commit = await anfrage(ctx, 'GET', r + '/git/commits/' + kopf);
    const baumSha = commit.tree.sha;

    const eintraege = [];
    for (const d of eingabe.dateien) {
      const blob = await anfrage(ctx, 'POST', r + '/git/blobs', { content: zuBase64(d.text), encoding: 'base64' });
      eintraege.push({ path: d.pfad, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const baum = await anfrage(ctx, 'POST', r + '/git/trees', { base_tree: baumSha, tree: eintraege });
    const neu = await anfrage(ctx, 'POST', r + '/git/commits', { message: eingabe.titel, tree: baum.sha, parents: [kopf] });

    if (eingabe.pr) {
      await anfrage(ctx, 'PATCH', r + '/git/refs/heads/' + pfadKodiert(branch), { sha: neu.sha, force: false }, [409, 422]);
      // Folgesendung: Titel auf den neuen Stand, Änderungsliste und Notiz als Kommentar (die PR-Beschreibung bleibt).
      await anfrage(ctx, 'PATCH', r + '/pulls/' + eingabe.pr.nummer, { title: eingabe.titel });
      await anfrage(ctx, 'POST', r + '/issues/' + eingabe.pr.nummer + '/comments', { body: eingabe.text });
      return { nummer: eingabe.pr.nummer, url: eingabe.pr.url, branch };
    }
    await anfrage(ctx, 'POST', r + '/git/refs', { ref: 'refs/heads/' + branch, sha: neu.sha }, [409, 422]);
    const pr = await anfrage(ctx, 'POST', r + '/pulls', { title: eingabe.titel, head: branch, base: ctx.basis, body: eingabe.text });
    return { nummer: pr.number, url: pr.html_url, branch };
  }

  async function status(ctx, nummer) {
    const pr = await anfrage(ctx, 'GET', '/repos/' + ctx.repo + '/pulls/' + nummer);
    if (pr.merged) return { zustand: 'gemergt', mergeSha: pr.merge_commit_sha || null };
    return { zustand: pr.state === 'closed' ? 'geschlossen' : 'offen', mergeSha: null };
  }

  return { zugriff, kopf, ladeDatei, offenerPr, sende, status };
});
