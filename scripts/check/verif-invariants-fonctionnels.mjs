#!/usr/bin/env node
// scripts/check/verif-invariants-fonctionnels.mjs
//
// UN seul détecteur pour les invariants fonctionnels perdus/dilués (V5 / Rendre méta /
// Mutualiser / Généraliser). 12 prédicats nommés, un chemin + une ligne par signal,
// sortie bornée. Distinct de check-test-masking.mjs (ses 4 sous-checks ne sont pas touchés).
//
// Contrat : verifierInvariants(diff) où diff est une liste de { path, line }.
// Chaque prédicat reçoit la liste entière (certains jugent un ordre, un compte ou une table),
// rend 0..N signaux { predicat, path, line, correction }.
//
// Découverte dynamique (aucune liste en dur au sens AR13) :
//   - whitespaceTrimSet() découvre au runtime les codepoints que trim() considère blancs ;
//   - display_name_golden lit tests/fixtures/display-name-goldens.json (readdir + JSON.parse),
//     une table vide ou absente est un REFUS immédiat (VB-4) ;
//   - discoverTargets() utilise git diff "$BASE" --name-only + git ls-files --others
//     (jamais git diff nu).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAX_SIGNAUX = 200; // borne de sortie, pas un seuil applicatif
const tronq = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 200);
const entree = (e) => e && typeof e.line === "string";
const lignesDe = (diff) => (Array.isArray(diff) ? diff.filter(entree) : []);
const signal = (predicat, e, correction) => ({
  predicat,
  path: e?.path ?? "(inconnu)",
  line: tronq(e?.line ?? ""),
  correction,
});

/** Découverte runtime des blancs reconnus par trim() — aucune liste codée en dur (AR13). */
export function whitespaceTrimSet() {
  const set = new Set();
  for (let cp = 0; cp <= 0xffff; cp++) {
    const ch = String.fromCharCode(cp);
    if (ch.trim() === "") set.add(ch);
  }
  return set;
}

/** Cibles = fichiers modifiés depuis BASE + fichiers non suivis. Jamais git diff nu. */
export function discoverTargets(repo = process.cwd(), base = process.env.BASE) {
  const cibles = new Set();
  if (!base) return [];
  const git = (args) => {
    try {
      return execFileSync("git", ["-C", repo, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return "";
    }
  };
  for (const ligne of git(["diff", base, "--name-only"]).split("\n"))
    if (ligne.trim()) cibles.add(ligne.trim());
  for (const ligne of git(["ls-files", "--others", "--exclude-standard"]).split("\n")) {
    if (ligne.trim()) cibles.add(ligne.trim());
  }
  return [...cibles].sort();
}

// ---------------------------------------------------------------------------
// 1. compteur_egale_parseur (CR-A1) — compte de lignes vs trim() Unicode
// ---------------------------------------------------------------------------
export function compteur_egale_parseur(diff) {
  const ws = whitespaceTrimSet();
  const echapes = new Set(
    [...ws].map((ch) => `\\u${ch.codePointAt(0).toString(16).padStart(4, "0")}`)
  );
  const lignes = lignesDe(diff);
  const bruts = [];
  let aligne = false;
  for (const e of lignes) {
    const l = e.line;
    if (
      /\b(?:total|count|compte|nbLignes|lineCount)\s*=\s*[^;\n]*\.split\([^)]*\)\.length\b/.test(l)
    )
      bruts.push(e);
    // Nominal : le compte filtre effectivement les blancs (trim) avant de compter.
    // La seule présence d'une validation JSON n'aligne PAS le compteur (CR-A1).
    if (/\.filter\([^)]*\btrim\s*\(/.test(l)) aligne = true;
    for (const esc of echapes) if (l.includes(esc)) aligne = true;
  }
  if (bruts.length === 0 || aligne) return [];
  return bruts.map((e) =>
    signal(
      "compteur_egale_parseur",
      e,
      "aligner le compteur sur le parseur : filtrer les lignes blanches (blancs trim() découverts au runtime) avant de compter"
    )
  );
}

// ---------------------------------------------------------------------------
// 2. parite_sonde_executeur (CR-A6) — clé Bearer sonde vs exécuteur
// ---------------------------------------------------------------------------
function bearerValeur(ligne) {
  const i = ligne.indexOf("Bearer");
  if (i < 0) return null;
  const m = ligne.slice(i + 6).match(/\b(anonymous|[A-Za-z_$][\w$]*)\b/);
  return m ? m[1] : null;
}

export function parite_sonde_executeur(diff) {
  const valeurs = lignesDe(diff)
    .map((e) => bearerValeur(e.line))
    .filter(Boolean);
  if (valeurs.length < 2) return [];
  const distinct = new Set(valeurs);
  if (distinct.size === 1) return []; // même Bearer des deux côtés (y compris les deux anonymous)
  const premiere = lignesDe(diff).find((e) => bearerValeur(e.line));
  return [
    signal(
      "parite_sonde_executeur",
      premiere,
      `Bearer divergent entre sonde et exécuteur : ${[...distinct].join(" / ")} — utiliser la même clé des deux côtés`
    ),
  ];
}

// ---------------------------------------------------------------------------
// 3. denominateur_complet (CR-A9) — rang/attempt affiché
// ---------------------------------------------------------------------------
export function denominateur_complet(diff) {
  const out = [];
  for (const e of lignesDe(diff)) {
    const l = e.line;
    if (!/\$\{[^}]*\}\s*\/\s*\$?\{|\b(?:attempt|rang|i|index)\w*\s*\/\s*[^`\n]{1,80}/.test(l))
      continue;
    const partiel =
      /\.filter\s*\(|\.slice\s*\(|Math\.min\s*\(|\bcap\b|\bcapped\b/.test(l) ||
      !/\.length\b|\btotal\b|\bcompte\b/.test(l);
    if (partiel) {
      out.push(
        signal(
          "denominateur_complet",
          e,
          "dénominateur partiel : ne pas filtrer/caper les tentatives avant d'afficher le total (3 tentatives -> 1/3)"
        )
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. regex_frontiere_propriete (CR-A12) — regex de retry sur message d'erreur
// ---------------------------------------------------------------------------
export function regex_frontiere_propriete(diff) {
  const out = [];
  const regexSurMessage =
    /\.test\s*\([^)]*\bmessage\b[^)]*\)|\bmessage\b\s*\.\s*match\s*\(|\bmessage\b[^\n]{0,60}\.test\s*\(/;
  for (const e of lignesDe(diff)) {
    const l = e.line;
    if (!/\bretry\b|\bretrier\b|nouvel essai/i.test(l)) continue;
    if (regexSurMessage.test(l)) {
      out.push(
        signal(
          "regex_frontiere_propriete",
          e,
          "décider le retry sur err.code (ECONNRESET), pas sur une regex du message : " +
            "une erreur de propriété (reading 'network') ne doit pas déclencher de retry"
        )
      );
    }
  }
  return out;
}

/** Regroupe les lignes par chemin en conservant l'ordre (pour les prédicats d'ordre). */
function grouperParChemin(diff) {
  const groupes = new Map();
  for (const e of lignesDe(diff)) {
    if (!groupes.has(e.path)) groupes.set(e.path, []);
    groupes.get(e.path).push(e);
  }
  return groupes;
}

// ---------------------------------------------------------------------------
// 5. emission_apres_sink (CR-A13) — log autour de setHostSink
// ---------------------------------------------------------------------------
export function emission_apres_sink(diff) {
  const out = [];
  const LOG = /\b(?:ctx\s*\.\s*client\s*\.\s*app\s*\.\s*log|app\s*\.\s*log)\s*\(/;
  for (const [chemin, ls] of grouperParChemin(diff)) {
    const sink = ls.findIndex((e) => /\bsetHostSink\s*\(/.test(e.line));
    const log = ls.findIndex((e) => LOG.test(e.line));
    if (log < 0) continue;
    if (sink >= 0 && log > sink) continue; // nominal : log émis après le sink
    out.push(
      signal(
        "emission_apres_sink",
        ls[log],
        `chemin ${chemin} : avertissement émis avant setHostSink (ou setup sans ctx.client.app.log) — émettre après le sink`
      )
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. attente_active (CR-C3) — setImmediate/nextTick dans une boucle
// ---------------------------------------------------------------------------
// Formes de busy-wait dans une boucle (table T14 / CR-C3) :
//   - await new Promise(r => setImmediate(r))   (forme historique)
//   - setImmediate(fn) direct                   (découverte du reviewer, round 1)
//   - process.nextTick(fn)                      (découverte du reviewer, round 1)
const ATTENTE_ACTIVE_RE = [
  /\bawait\s+new\s+Promise\s*\([^)]*\bsetImmediate\s*\(/,
  /\bsetImmediate\s*\(/,
  /\bprocess\s*\.\s*nextTick\s*\(/,
];

export function attente_active(diff) {
  const out = [];
  for (const [, ls] of grouperParChemin(diff)) {
    // Une file d'attente explicite (waiters.push(resolve)) rend l'attente active : le
    // worker ne tourne pas à vide. Portée au fichier, pas à la seule ligne await.
    const aDesWaiters = ls.some((e) => /waiters\s*\.\s*push/.test(e.line));
    let dansBoucle = false;
    for (const e of ls) {
      if (/\b(?:while|for)\s*\(/.test(e.line)) dansBoucle = true;
      if (dansBoucle && !aDesWaiters && ATTENTE_ACTIVE_RE.some((re) => re.test(e.line))) {
        out.push(
          signal(
            "attente_active",
            e,
            "busy-wait : setImmediate (direct ou dans await new Promise) ou process.nextTick " +
              "dans une boucle de worker — utiliser une file waiters.push(resolve)"
          )
        );
      }
      if (/^\s*\}/.test(e.line)) dansBoucle = false;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7. display_name_golden (CR-C11/CR-C12, PR 18230) — table lue au runtime
// ---------------------------------------------------------------------------
export function display_name_golden(diff, opts = {}) {
  const dir = opts.goldensDir || path.join(process.cwd(), "tests", "fixtures");
  const nomFichier = "display-name-goldens.json";
  let cas = [];
  try {
    if (fs.readdirSync(dir).includes(nomFichier)) {
      const table = JSON.parse(fs.readFileSync(path.join(dir, nomFichier), "utf8"));
      cas = Array.isArray(table?.cas) ? table.cas : Array.isArray(table) ? table : [];
    }
  } catch {
    cas = [];
  }
  if (cas.length === 0) {
    return [
      {
        predicat: "display_name_golden",
        path: nomFichier,
        line: "(table absente ou vide)",
        correction:
          "créer/remplir tests/fixtures/display-name-goldens.json — table vide ou absente = REFUS immédiat (VB-4)",
      },
    ];
  }
  const declencheurs = lignesDe(diff).filter((e) =>
    /\bbuildModelDisplayName\b|\bpublishCombos\b/.test(e.line)
  );
  if (declencheurs.length === 0) return [];
  const garde = lignesDe(diff).some(
    (e) => /\bstartsWith\s*\(/.test(e.line) && /\bprefix|PREFIXE|prefixe\b/i.test(e.line)
  );
  const naif = lignesDe(diff).some(
    (e) =>
      /\breplace\s*\(\s*\/\^/.test(e.line) || /\.split\s*\(\s*["']\s*-\s*["']\s*\)/.test(e.line)
  );
  if (garde && !naif) return [];
  const nomLu =
    cas.find((c) => /\s-\s/.test(c?.name || ""))?.name ?? cas[0]?.name ?? "(nom lu dans la table)";
  return [
    signal(
      "display_name_golden",
      declencheurs[0],
      `strip non gardé par startsWith(prefix) — ${cas.length} goldens lus (ex. « ${tronq(nomLu)} ») ; ` +
        "le nom complet doit être conservé, seul le vrai préfixe est strippé"
    ),
  ];
}

// ---------------------------------------------------------------------------
// 8. source_garde_avant_predicat (CR-B4/F4) — combosSource + isUserComboRow
// ---------------------------------------------------------------------------
export function source_garde_avant_predicat(diff) {
  const ls = lignesDe(diff).map((e, i) => ({ ...e, i }));
  const predicat = ls.findIndex((e) => /\bisUserComboRow\s*\(/.test(e.line));
  if (predicat < 0) return [];
  const garde = ls.findIndex(
    (e) =>
      /\bcombosSource\b[^\n]{0,80}[!=]==?\s*["']models["']/.test(e.line) ||
      /["']models["']\s*[!=]==?\s*\w*combosSource/.test(e.line)
  );
  if (garde < 0 || garde < predicat) return [];
  return [
    signal(
      "source_garde_avant_predicat",
      ls[predicat],
      "garde combosSource placé après isUserComboRow — tester la source par défaut avant le prédicat " +
        "(combosSource:'models' + ID kg/auto-fallback)"
    ),
  ];
}

// ---------------------------------------------------------------------------
// 9. normalisation_prefixe_gardee (CR-B6/F6) — replace sur un nom de tarball
// ---------------------------------------------------------------------------
export function normalisation_prefixe_gardee(diff) {
  const ls = lignesDe(diff).map((e, i) => ({ ...e, i }));
  const out = [];
  for (const e of ls) {
    if (!/\.replace\s*\(\s*(?:["'`]package\/|\/\^?package\/)/.test(e.line)) continue;
    const garde = ls.some((g) => g.i < e.i && /startsWith\s*\(\s*["'`]package\//.test(g.line));
    if (!garde) {
      out.push(
        signal(
          "normalisation_prefixe_gardee",
          e,
          "replace('package/') sans startsWith('package/') préalable — rejeter l'entrée sans préfixe"
        )
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 10. horloge_activite_rafraichie (CR-B7/F7) — lastActivityAt
// ---------------------------------------------------------------------------
export function horloge_activite_rafraichie(diff) {
  const ecritures = lignesDe(diff).filter((e) => /\blastActivityAt\s*=/.test(e.line));
  if (ecritures.length === 0) return [];
  const contexte = ecritures.map((e) => e.line).join("\n");
  const demarrage = /demarrage|d[ée]marrage|\bstart\b|\binit\b|constructor/i.test(contexte);
  const release = /\brelease\b/i.test(contexte);
  const fin = /\bfinally\b|noteStreamableInflight\s*\(\s*-1\s*\)/.test(contexte);
  if (demarrage && release && fin) return [];
  return [
    signal(
      "horloge_activite_rafraichie",
      ecritures[0],
      `${ecritures.length} écriture(s) de lastActivityAt — attendu 3 : démarrage, release, finally(noteStreamableInflight(-1))`
    ),
  ];
}

// ---------------------------------------------------------------------------
// 11. assertion_payload_publie (CR-B3/F3) — assert sur provider vs payload m1
// ---------------------------------------------------------------------------
export function assertion_payload_publie(diff) {
  const txt = lignesDe(diff)
    .map((e) => e.line)
    .join("\n");
  if (!/\bprovider\b/i.test(txt)) return [];
  const asserts = lignesDe(diff).filter((e) =>
    /\bassert\s*\(|\bassert\s*\.\s*\w+\s*\(|\bexpect\s*\(/.test(e.line)
  );
  if (asserts.length === 0) return [];
  const payload = /\bassert[^\n]{0,120}\b(?:model|payload|m1)\b|["'`]m1["']/.test(txt);
  const providerSeul = asserts.some(
    (e) => /provider/i.test(e.line) && !/\bmodel\b|["']m1["']/.test(e.line)
  );
  if (payload && !providerSeul) return [];
  return [
    signal(
      "assertion_payload_publie",
      asserts.find((e) => /provider/i.test(e.line)) ?? asserts[0],
      "assert porte sur le seul nom de provider — ajouter un assert sur le payload publié (modèle 'm1')"
    ),
  ];
}

// ---------------------------------------------------------------------------
// 12. test_hygiene (CR-A4/A7/A8/A9/A12, B8/B12, C6/C10)
// ---------------------------------------------------------------------------
export function test_hygiene(diff) {
  const out = [];
  for (const [chemin, ls] of grouperParChemin(diff)) {
    const txt = ls.map((e) => e.line).join("\n");
    const retour = ls.findIndex((e) => /\breturn\s*;/.test(e.line));
    const assert = ls.findIndex((e) =>
      /\bassert\s*\(|\bassert\s*\.\s*\w+\s*\(|\bexpect\s*\(/.test(e.line)
    );
    if (retour >= 0 && assert >= 0 && retour < assert) {
      out.push(
        signal("test_hygiene", ls[retour], `${chemin} : return; avant assert — test tronqué`)
      );
    }
    const mock = txt.match(/\bconst\s+(\w*[Mm]ock\w*)\s*=/);
    if (mock && /\b(?:sut|SUT|build|run|create)\w*\s*\(/.test(txt)) {
      const nom = mock[1];
      const passeSecond = txt.includes(`, ${nom})`) || txt.includes(`,${nom})`);
      if (!passeSecond && txt.includes(`(${nom})`)) {
        const e = ls.find((x) => x.line.includes(`(${nom})`));
        out.push(
          signal("test_hygiene", e, `${chemin} : mock ${nom} non passé en 2e argument au SUT`)
        );
      }
    }
    if (
      /expect\s*\([^)]*\.some\s*\([^)]*\)\)\s*\.\s*toBe\s*\(\s*false\s*\)/.test(txt) &&
      !/\.some\s*\([^)]*\b(?:id|name|model|provider)\b/.test(txt)
    ) {
      const e = ls.find((x) => /\.some\s*\(/.test(x.line));
      out.push(
        signal(
          "test_hygiene",
          e,
          `${chemin} : expect(x.some(...)).toBe(false) sans lien vérifiable`
        )
      );
    }
    const tick = ls.findIndex((e) => /\btick\s*\(/.test(e.line));
    const timeout = ls.findIndex((e) =>
      /setTimeout\s*\(\s*(?:async\s*)?\(?[^;]*\bassert\b/.test(e.line)
    );
    if (tick >= 0 && timeout > tick && !/Promise\s*\.\s*race\s*\(/.test(txt)) {
      out.push(
        signal(
          "test_hygiene",
          ls[timeout],
          `${chemin} : setTimeout(assert, 200) après tick() sans Promise.race de garde`
        )
      );
    }
  }
  return out;
}

export const PREDICATS = Object.freeze({
  compteur_egale_parseur,
  parite_sonde_executeur,
  denominateur_complet,
  regex_frontiere_propriete,
  emission_apres_sink,
  attente_active,
  display_name_golden,
  source_garde_avant_predicat,
  normalisation_prefixe_gardee,
  horloge_activite_rafraichie,
  assertion_payload_publie,
  test_hygiene,
});
export const NOMS_PREDICATS = Object.keys(PREDICATS);

/** Orchestrateur : un signal = un prédicat nommé + un chemin + une ligne. Sortie bornée. */
export function verifierInvariants(diff, opts = {}) {
  const entrees = lignesDe(diff);
  const bruts = [];
  for (const [nom, predicat] of Object.entries(PREDICATS)) {
    try {
      bruts.push(...(predicat(entrees, opts) || []));
    } catch (err) {
      bruts.push({
        predicat: nom,
        path: "(erreur)",
        line: tronq(err?.message ?? err),
        correction: "rejouer le prédicat",
      });
    }
  }
  const vus = new Set();
  const bornes = [];
  for (const s of bruts) {
    const cle = `${s.predicat}|${s.path}|${s.line}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    bornes.push(s);
    if (bornes.length >= MAX_SIGNAUX) break;
  }
  return bornes;
}

// ---------------------------------------------------------------------------
// CLI — découverte dynamique, garde BASE, sortie bornée.
// ---------------------------------------------------------------------------
const EST_CLI =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (EST_CLI) {
  const base = process.env.BASE || process.env.BINOME_BASE;
  if (!base) {
    console.error("REFUS : BASE absent — exporter BASE (base.sh) avant d'invoquer le détecteur");
    process.exit(2);
  }
  let resolu = true;
  try {
    execFileSync("git", ["rev-parse", "--verify", "-q", `${base}^{commit}`], { stdio: "ignore" });
  } catch {
    resolu = false;
  }
  if (!resolu) {
    console.error(`REFUS : ${base} ne résout pas — vérifier base.sh / upstream`);
    process.exit(2);
  }
  const cibles = discoverTargets(process.cwd(), base).filter(
    (f) => !f.endsWith(".test.mjs") && f !== "scripts/check/verif-invariants-fonctionnels.mjs"
  );
  const diff = [];
  for (const f of cibles) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    const lignes = src.split("\n");
    for (let i = 0; i < lignes.length; i++) diff.push({ path: f, line: lignes[i], numero: i + 1 });
  }
  const signaux = verifierInvariants(diff);
  let refus = 0;
  for (const s of signaux.slice(0, MAX_SIGNAUX)) {
    refus++;
    console.log(`REFUS ${s.predicat} ${s.path} : ${s.line}`);
    console.log(`  correction : ${s.correction}`);
  }
  console.log(`verif-invariants-fonctionnels : ${diff.length} ligne(s) évaluée(s), ${refus} REFUS`);
  process.exit(refus > 0 ? 1 : 0);
}
