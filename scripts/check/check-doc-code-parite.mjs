#!/usr/bin/env node
// scripts/check/check-doc-code-parite.mjs
// Parité doc ↔ code (T11). Chaque affirmation dans `*.md` / `changelog.d/**` est
// confrontée à une preuve exécutable par PRÉDICAT NOMMÉ ; à défaut, elle doit porter
// le marqueur `SELON AUTEUR`. Un prédicat = une classe, pas un script par finding (V5/C-24).
//
// Découverte des cibles : `git diff "$BASE" --name-only` + `git ls-files --others`,
// jamais `git diff` nu (0 cible sur PR commitée). `BASE` est fourni par base.sh.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Step 2 — regex RÉELLE réutilisée TELLE QUELLE de `MAINTENANCE.md:212` :
//   (?<![-\w])([./]?[\w./-]+\.[A-Za-z0-9]+):(\d+)\b
// Lookbehind largeur 1, `\b` final, PAS de `(?![-\w])` final (C-21). L'inventer
// refuserait `ci.yml:42-43` (ancrage avec point initial). Mutualiser, pas dupliquer.
export const ANCRAGE_RE = /(?<![-\w])([./]?[\w./-]+\.[A-Za-z0-9]+):(\d+)\b/;

const MARQUEUR_AUTEUR = "SELON AUTEUR";

// ---------------------------------------------------------------------------
// 1. verdicts_alignes — VB-2 : les valeurs viennent du CODE, jamais du changelog.
//    `20462.review.txt:7,22` : le changelog affirme « verdicts now agree » alors
//    que preview renvoie `rate_limit` et failover `quota_exhausted`.
//    `changelog` est accepté pour compatibilité d'interface mais JAMAIS lu comme
//    source de valeurs. Lire « les deux valeurs dans la doc » rendrait le
//    prédicat tautologique ; `SELON AUTEUR` ne s'applique pas ici (le code prouve).
// ---------------------------------------------------------------------------
const VERDICT_RE = /\b(rate_limit|quota_exhausted)\b/g;
export function verdicts_alignes({ code = "", changelog = "", affirmation = "" } = {}) {
  void changelog; // source interdite, explicitement ignorée (VB-2)
  const valeurs = new Set();
  for (const m of String(code).matchAll(VERDICT_RE)) valeurs.add(m[1]);
  if (valeurs.size < 2) return false; // un seul verdict → accord invérifiable → REFUS
  // L'affirmation (et non le changelog) porte la revendication à juger : si elle
  // prétend à l'accord alors que le code porte deux verdicts distincts → REFUS.
  if (/\b(?:now agree|agree|align|converge|d'accord)\b/i.test(String(affirmation))) return false;
  return true; // les deux verdicts sont bien lus dans le code → comparaison ancrée
}

// ---------------------------------------------------------------------------
// 2. id_classe_par_le_predicat — ID étiqueté `router` dans un README.
//    Nominal : `isRouterEntryId` reconnaît l'ID documenté. Limite : non reconnu.
// ---------------------------------------------------------------------------
// Sémantique alignée sur l'amont `router-id.ts:14` (segments après le premier `/`).
export function isRouterEntryId(id) {
  const s = String(id);
  const segments = s.split("/").slice(1);
  return (
    segments.some(
      (seg) =>
        seg === "auto" ||
        seg.startsWith("auto-") ||
        seg.startsWith("auto:") ||
        seg === "free" ||
        seg === "pareto-code" ||
        seg === "bodybuilder"
    ) || /^(?:auto:|free$|pareto-code$|bodybuilder$)/i.test(s)
  );
}
export function id_classe_par_le_predicat({ doc = "", code = "" } = {}) {
  const t = String(doc);
  const m =
    t.match(/\brouter\b[^\n]{0,80}?[`"' ]([a-z0-9][\w.:/-]*)[`"' ]/i) ||
    t.match(/\b(?:openrouter|router)[\w.:/-]*\/(?:auto[\w:-]*|free|pareto-code|bodybuilder)\b/i);
  if (!m) return false; // aucun ID documenté → rien à confronter
  const id = m[1];
  return (
    isRouterEntryId(id) && /\bisRouterEntryId\b/.test(String(code)) && String(code).includes(id)
  );
}

// ---------------------------------------------------------------------------
// 3. durabilite_stockage_partage — mention `storage.sqlite`/restart.
//    Indépendant de l'opt-out (C-19) : stockage partagé OU explicite suffit.
// ---------------------------------------------------------------------------
export function durabilite_stockage_partage({ doc = "", code = "" } = {}) {
  if (!/\bstorage\.sqlite\b|\brestart\b|red[ée]marr/i.test(String(doc))) return false;
  const c = String(code);
  const dirPartagee =
    /\bDATA_DIR\b/.test(c) &&
    /(?:process\.env\.DATA_DIR|DATA_DIR\s*[=:]|resolve\(.*DATA_DIR)/.test(c);
  const stockageExplicite =
    /\bstorage\.sqlite\b/.test(c) && /\b(?:reuse|same|partag|persist|open)\b/i.test(c);
  return dirPartagee || stockageExplicite;
}

// ---------------------------------------------------------------------------
// 4. durabilite_optout_nomme — variable d'opt-out nommée et LUE dans le code.
//    Indépendant du stockage (C-19).
// ---------------------------------------------------------------------------
export function durabilite_optout_nomme({ doc = "", code = "" } = {}) {
  const t = String(doc);
  const names = [...t.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)].map((m) => m[1]);
  const opt = names.find((n) => /OPT|OPTOUT|DISABLE|NO_|SKIP|DESACTIVE/i.test(n));
  if (!opt) return false; // aucune variable nommée → REFUS
  const c = String(code);
  return new RegExp(`(?:process\\.env|env|config)\\.${opt}\\b|\\b${opt}\\b`).test(c);
}

// ---------------------------------------------------------------------------
// 5. durabilite_rehydratation_active — réhydratation AVANT l'early-return de
//    `inspectCcrBlock`. `retrieveBlock` vit dans `ccr/index.ts:531,691`, PAS dans
//    `compressionTools.ts` (C-20) : on ne vérifie donc jamais un ordre textuel
//    `retrieveBlock` avant `found:false` dans le handler — on juge le module CCR.
// ---------------------------------------------------------------------------
export function durabilite_rehydratation_active({ code = "", handler = "" } = {}) {
  void handler; // fichier handler sans retrieveBlock : jamais source de l'ordre (C-20)
  const c = String(code);
  const debut = c.search(/\binspectCcrBlock\b/);
  if (debut === -1) return false; // aucun inspectCcrBlock → REFUS
  // Ne pas confondre la DÉFINITION `retrieveBlock` (:531) avec son APPEL dans
  // inspectCcrBlock (:691) — sans cette portée, l'ordre textuel est faux.
  const portee = c.slice(debut);
  const rehydratation = portee.search(/\bretrieveBlock\s*\(/);
  if (rehydratation === -1) return false; // aucune réhydratation → REFUS
  const earlyReturn = portee.search(/if\s*\([^)]*\bfound\b[^)]*\)\s*(?:return|\{)/i);
  if (earlyReturn === -1) return true; // pas d'early-return bloquant → actif
  return rehydratation < earlyReturn; // réhydratation avant l'early-return → vert
}

// ---------------------------------------------------------------------------
// 6. chiffre_mesure — chiffre de pack/temps/compte : source mesurée ou marqueur.
// ---------------------------------------------------------------------------
export function chiffre_mesure({ doc = "" } = {}) {
  const t = String(doc);
  const chiffre =
    /\b\d+(?:[.,]\d+)?\s*(?:ms|s\b|Mo|GiB|%|×|x)\b/i.test(t) ||
    /\b\d+\s*(?:PR|packs?|mod[èe]les?|requ[êe]tes?|lignes?)\b/i.test(t);
  if (!chiffre) return true; // aucun chiffre → aucune exigence
  if (t.includes(MARQUEUR_AUTEUR)) return true;
  const source =
    /\b(?:source|mesur|benchmark|CI\b|tableau|journal|run\b|collect[ée])\b/i.test(t) ||
    ANCRAGE_RE.test(t); // ancrage `fichier:ligne` = preuve citée
  return source;
}

// ---------------------------------------------------------------------------
// 7. corps_pr_renseigne — VB-3 : logique CORRIGÉE. Toutes les cases cochées ET
//    `Closes|Related to #\d+` (ou mention explicite « aucun issue lié »).
//    L'ancienne logique validait le défaut et refusait le cas conforme.
//    `pr-conventions.sh corps` est le moment réel (C-35) ; `--body` n'existe pas.
// ---------------------------------------------------------------------------
export function corps_pr_renseigne({ corps = "" } = {}) {
  const c = String(corps);
  const cases = [...c.matchAll(/^\s*-\s*\[([ xX])\]/gm)].map((m) => m[1].toLowerCase());
  if (cases.length === 0) return false; // pas de gabarit → REFUS
  if (cases.some((v) => v !== "x")) return false; // UNE case non cochée → REFUS
  // ⚠️ pas de `\b` après « lié » : en JS `\b` est ASCII-only, `é` est non-mot →
  // la frontière n'existe jamais. Même piège que le `\b` final de ANCRAGE_RE.
  const issue =
    /\b(?:Closes|Related to)\s+#\d+\b/i.test(c) || /aucun issue li[ée]|no linked issue/i.test(c);
  return issue; // aucune issue → REFUS
}

// ---------------------------------------------------------------------------
// 8. ecritures_transactionnelle — lecture de la valeur courante DANS la
//    transaction + écriture colonne-ciblée. REFUS si `cooldown`/`tier` modifié
//    pendant le vol (RMW hors transaction).
// ---------------------------------------------------------------------------
export function ecriture_transactionnelle({ code = "" } = {}) {
  const c = String(code);
  const tx = c.search(/\b(?:db\.)?transaction\s*\(|\bBEGIN\b/i);
  if (tx === -1) return false; // aucune transaction → REFUS
  const lecture = c.search(/\b(?:SELECT|read\w*|get\w*)\b[^\n]{0,120}\b(?:cooldown|tier|value)\b/i);
  if (lecture === -1 || lecture < tx) return false; // valeur lue hors transaction → REFUS
  const ecritureCiblee =
    /\bUPDATE\b[^\n]{0,160}\bSET\b[^\n]{0,120}\b(?:cooldown|tier|value)\b/i.test(c) ||
    /\btx\.(?:update|query)\b[^\n]{0,120}\b(?:cooldown|tier|value)\b/i.test(c);
  if (!ecritureCiblee) return false; // écriture non ciblée → REFUS
  const deriveHorsTransaction =
    /\b(?:cooldown|tier)\s*(?:\+\+|--|[+*/-]?=)(?!=)/.test(c.slice(0, tx)) ||
    /\b(?:cooldown|tier)\s*\+=/.test(c);
  return !deriveHorsTransaction;
}

export const PREDICATS = Object.freeze({
  verdicts_alignes,
  id_classe_par_le_predicat,
  durabilite_stockage_partage,
  durabilite_optout_nomme,
  durabilite_rehydratation_active,
  chiffre_mesure,
  corps_pr_renseigne,
  ecriture_transactionnelle,
});

// ---------------------------------------------------------------------------
// Orchestration : pour chaque ligne modifiée de doc, choisir le prédicat par
// déclencheur réel, l'exécuter, et exiger `SELON AUTEUR` sinon (sauf
// `verdicts_alignes`, où le marqueur ne s'applique pas — VB-2).
// ---------------------------------------------------------------------------
const DECLENCHEURS = [
  [
    "verdicts_alignes",
    /\b(?:verdicts?\s+now\s+agree|rate_limit|quota_exhausted|verdicts?\s+align)/i,
  ],
  ["id_classe_par_le_predicat", /\brouter\b/i],
  ["durabilite_stockage_partage", /\bstorage\.sqlite\b|\brestart\b|red[ée]marr/i],
  ["durabilite_optout_nomme", /\b(?:OPT|OPTOUT|DISABLE|NO_|SKIP|DESACTIVE)_[A-Z0-9_]+\b/],
  ["durabilite_rehydratation_active", /\b(?:eviction|TTL|found\s*:\s*false)\b/i],
  ["chiffre_mesure", /\b\d+(?:[.,]\d+)?\s*(?:ms|s\b|Mo|GiB|%|×|x|PR|packs?|mod[èe]les?)\b/i],
  ["corps_pr_renseigne", /-\s*\[[ xX]\]|\bCloses\b|\bRelated to\b/],
  ["ecriture_transactionnelle", /\b(?:RMW|cooldown|tier)\b/i],
];

export function doc_code_parite({ docs = [], preuves = {} } = {}) {
  const refus = [];
  let evalues = 0;
  for (const { file, text } of docs) {
    if (!(/\.md$/i.test(file) || file.includes("changelog.d/"))) continue;
    for (const ligne of String(text).split(/\r?\n/)) {
      const entry = DECLENCHEURS.find(([, re]) => re.test(ligne));
      if (!entry) continue;
      const [nom] = entry;
      if (nom !== "verdicts_alignes" && ligne.includes(MARQUEUR_AUTEUR)) continue;
      evalues += 1;
      const args = {
        doc: ligne,
        code: preuves.code ?? "",
        handler: preuves.handler ?? "",
        corps: preuves.corps ?? "",
        changelog: ligne,
        affirmation: ligne,
      };
      let ok = false;
      try {
        ok = PREDICATS[nom](args) === true;
      } catch {
        ok = false; // prédicat qui jette = REFUS, jamais un `||` toujours vrai
      }
      if (!ok) refus.push({ file, ligne, predicat: nom });
    }
  }
  return { ok: refus.length === 0, refus, comptage: { evalues, refus: refus.length } };
}

// Découverte bornée des cibles (jamais `git diff` nu).
export function discoverTargets(worktree, base) {
  if (!base) throw new Error("BASE absente — source base.sh (garde_base)");
  const changees = execFileSync("git", ["-C", worktree, "diff", base, "--name-only"], {
    encoding: "utf8",
  });
  const autres = execFileSync(
    "git",
    ["-C", worktree, "ls-files", "--others", "--exclude-standard"],
    { encoding: "utf8" }
  );
  const tout = [...changees.trim().split("\n"), ...autres.trim().split("\n")].filter(Boolean);
  return [...new Set(tout)].filter((f) => /\.md$/i.test(f) || f.includes("changelog.d/"));
}

function main() {
  const worktree = process.env.WORKTREE || process.cwd();
  const base = process.env.BASE || "";
  if (!base) {
    console.error(
      'REFUS : BASE absente — exporter BASE (base.sh) puis garde_base <worktree> "$BASE"'
    );
    process.exit(2);
  }
  const cibles = discoverTargets(worktree, base);
  const docs = cibles.slice(0, 1000).map((file) => ({
    file,
    text: fs.readFileSync(path.join(worktree, file), "utf8"),
  }));
  const resultat = doc_code_parite({ docs, preuves: {} });
  console.log(
    `doc-code-parite : ${resultat.comptage.evalues} évaluée(s), ${resultat.comptage.refus} REFUS`
  );
  for (const r of resultat.refus.slice(0, 50)) {
    console.log(`REFUS ${r.predicat} ${r.file} : ${r.ligne.trim().slice(0, 160)}`);
  }
  if (!resultat.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
