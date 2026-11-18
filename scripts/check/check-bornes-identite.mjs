#!/usr/bin/env node
// scripts/check/check-bornes-identite.mjs
// Bornes numériques et identité / ownership (T12). Cinq prédicats nommés
// réutilisables, chacun avec un cas nominal et un cas limite exécuté (AR16).
// L'attente active (setImmediate en boucle) est couverte par `attente_active`
// en T14 (C-11) : elle n'est PAS une borne et n'est donc pas traitée ici.
//
// Découverte des cibles : `git diff "$BASE" --name-only` + `git ls-files --others`,
// jamais `git diff` nu (0 cible sur PR commitée). `BASE` vient de base.sh.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// INT32_MAX : constante plateforme (O-15), PAS un magic number au sens AR13.
export const INT32_MAX = 2147483647;
// MAX_TOTAL (bornes inchangées V4) : valeur de repli numérique.
export const REPLI = 3000;
const MS_PAR_JOUR = 86400000;

// ---------------------------------------------------------------------------
// 1. borne_numerique — parseur borné réutilisable.
//    `^\d+$` + Number.isSafeInteger > 0 + repli + Math.min(expr, INT32_MAX).
//    Limite : "100_000" -> repli (pas 100) ; 1+300 zéros -> repli (pas Infinity).
// ---------------------------------------------------------------------------
export function borne_numerique(brut, { repli = REPLI, plafond = INT32_MAX } = {}) {
  const s = String(brut).trim();
  if (!/^\d+$/.test(s)) return repli;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return repli;
  return Math.min(n, plafond);
}

// TTL borné : 30 jours -> INT32_MAX ms, jamais effondré à 1 ms.
export function borne_ttl_ms(jours, { repli = REPLI, plafond = INT32_MAX } = {}) {
  const n = borne_numerique(jours, { repli, plafond: Number.MAX_SAFE_INTEGER });
  if (n === repli) return repli;
  const ms = n * MS_PAR_JOUR;
  if (!Number.isSafeInteger(ms)) return plafond;
  return Math.min(Math.max(ms, 1), plafond);
}

// Durée canonique d'un TTL de 30 jours : 2 592 000 000 ms (dérivée de MS_PAR_JOUR,
// pas une constante applicative codée en dur).
export const TTL_30J_MS = 30 * MS_PAR_JOUR;

// ---------------------------------------------------------------------------
// 1b. ttl_30j_non_effondre — limite canonique du brief « TTL 30 j -> 1 ms ».
//     Le plafonnement de `borne_ttl_ms` ne REMPLACE PAS la détection du défaut :
//     quand le code annonce 30 jours (commentaire ou expression attendue) mais
//     pose `ttl = 1`, on refuse avec chemin + ligne + commande de correction.
//     Sans contexte 30 j, aucun signal (pas de faux REFUS sur un TTL légitime).
// ---------------------------------------------------------------------------
const ATTENDU_30J_RE =
  /30\s*\*\s*86400\s*\*\s*1000|30\s*\*\s*MS_PAR_JOUR|30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|2[_ ]?592[_ ]?000[_ ]?000|30\s*(?:j|jours?|days?)\b/i;
const TTL_EFFONDRE_RE = /\bttl\w*\s*[:=]\s*1\b/i;

export function ttl_30j_non_effondre({ code = "", ligne = "" } = {}) {
  const cible = String(ligne || code);
  if (!TTL_EFFONDRE_RE.test(cible)) return true; // pas de `ttl = 1` -> rien à signaler
  // Contexte borné à ±3 lignes : un 30 j ailleurs dans le fichier ne doit pas
  // faire refuser un TTL court légitime (pas de faux REFUS).
  const lignes = String(code).split(/\r?\n/);
  const idx = lignes.findIndex((l) => l === cible);
  const debut = idx === -1 ? 0 : Math.max(0, idx - 3);
  const fin = idx === -1 ? lignes.length : idx + 4;
  const voisinage = lignes.slice(debut, fin).join("\n");
  if (!ATTENDU_30J_RE.test(voisinage)) return true; // aucun 30 j attendu -> vert
  return false; // 30 j effondré à 1 ms -> REFUS
}

export const CORRECTION_TTL_30J =
  `correction : ttl = 30 * 86400 * 1000 (${TTL_30J_MS} ms) ou la borne validée ; ` +
  `rejouer 'node --test tests/unit/check-bornes-identite-predicats.test.mjs'`;

// ---------------------------------------------------------------------------
// 2. identite_item — identité issue d'une matrice de frames GÉNÉRÉE, jamais
//    d'un ID codé en dur. La dernière frame choice0 gagne ; la suppression
//    d'une frame choice-0 est interdite.
// ---------------------------------------------------------------------------
export function identite_item({ code = "", frames = [], candidat } = {}) {
  const c = String(code);
  if (/\bidentite\s*=\s*["'][A-Za-z0-9_-]+["']/.test(c)) return false; // ID codé en dur
  if (/\b(?:delete|splice|remove)\b[^\n]{0,80}\b(?:choix0|choice0)\b/i.test(c)) return false;
  if (!/\b(?:matrix|gen[eé]rer|generate|frames?\s*\.\s*(?:map|from)|for\s*\()/i.test(c)) {
    return false; // matrice non générée
  }
  const attendu = [...frames].reverse().find((f) => f && f.choix0)?.choix0 ?? null;
  if (attendu === null) return false;
  return candidat === undefined ? true : candidat === attendu;
}

// ---------------------------------------------------------------------------
// 3. cleanup_proprietaire — registry.get(X) === thisSetup avant delete(X).
//    C-13 : installation unique sans `existing` -> vert.
//    REFUS : ancienne instance modifie l'entrée du successeur ;
//            existing.stop() ne doit pas dominer refreshAndPublish().
// ---------------------------------------------------------------------------
export function cleanup_proprietaire({ code = "", evenements = [] } = {}) {
  const c = String(code);
  const gardeProprietaire =
    /\bregistry\s*\.\s*get\s*\([^)]*\)\s*===\s*thisSetup\b/.test(c) ||
    /\bfor\s*\([^)]*\bthisSetup\b/.test(c);
  const installationUnique =
    !/\bexisting\b/.test(c) && /\b(?:refreshAndPublish|install|register)\b/.test(c);
  if (!gardeProprietaire && !installationUnique) return false;
  if (/\bexisting\s*\.\s*stop\s*\(/.test(c) && /\brefreshAndPublish\b/.test(c)) {
    const iStop = c.search(/\bexisting\s*\.\s*stop\s*\(/);
    const iRefresh = c.search(/\brefreshAndPublish\b/);
    if (iStop < iRefresh) return false;
  }
  for (const e of evenements) {
    if (e.proprietaire !== e.cleanupPar) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 4. cle_resultat — getAllAccessTokens(rows) filtre connectionId truthy ;
//    onPersist retourne Promise<boolean> avec `if (!(await …)) throw`.
//    REFUS : `?? ''` ; callback nu.
// ---------------------------------------------------------------------------
export function cle_resultat({ code = "", onPersist = "" } = {}) {
  const c = String(code);
  const p = String(onPersist || c);
  if (/\?\?\s*["']{2}/.test(c)) return false; // repli vide interdit
  if (/\bgetAllAccessTokens\s*\(/.test(c)) {
    const filtre =
      /\.filter\s*\([^\n]{0,160}\bconnectionId\b/.test(c) ||
      /\bif\s*\([^)]*\bconnectionId\b/.test(c) ||
      /\bconnectionId\s*&&/.test(c);
    if (!filtre) return false;
  }
  const promesseBool = /Promise\s*<\s*boolean\s*>/.test(p) || /\basync\s*\(/.test(p);
  const garde = /if\s*\(\s*!\s*\(\s*await\b/.test(p) && /\bthrow\b/.test(p);
  return promesseBool && garde; // callback nu -> garde absente -> REFUS
}

// ---------------------------------------------------------------------------
// 5. reprise_checkpoint — lot repris > limite -> vert, compte intact.
//    REFUS : porte d'admission appliquée à un lot repris ; compte écrasé.
// ---------------------------------------------------------------------------
export function reprise_checkpoint({ code = "", lots = [] } = {}) {
  const c = String(code);
  if (/\bcompte\s*=\s*\d+\s*[;,)]/.test(c) && !/\bcompte\s*(?:\+=|\+\s*1)/.test(c)) {
    return false; // compte écrasé
  }
  for (const lot of lots) {
    if (!lot || !lot.repris) continue;
    if (lot.admission) return false; // admission sur lot repris
    if (lot.compteEcrase) return false; // compte écrasé
  }
  return /reprise|checkpoint|repris/i.test(c) || lots.some((l) => l && l.repris);
}

export const PREDICATS = Object.freeze({
  borne_numerique,
  ttl_30j_non_effondre,
  identite_item,
  cleanup_proprietaire,
  cle_resultat,
  reprise_checkpoint,
});

const DECLENCHEURS = [
  // Prioritaire : un TTL 30 j effondré doit être refusé avant le simple bornage.
  [
    "ttl_30j_non_effondre",
    /\bttl\w*\s*[:=]\s*1\b|30\s*\*\s*86400\s*\*\s*1000|30\s*\*\s*MS_PAR_JOUR|2[_ ]?592[_ ]?000[_ ]?000|\b30\s*(?:j|jours?|days?)\b/i,
  ],
  ["borne_numerique", /\b(?:maxTokens?|ttl|borne|plafond|limit)\s*[:=]/i],
  ["identite_item", /\b(?:frames?|choix0|choice0|identite|identity)\b/i],
  ["cleanup_proprietaire", /\b(?:registry|cleanup|existing|refreshAndPublish|thisSetup)\b/],
  ["cle_resultat", /\b(?:getAllAccessTokens|onPersist|connectionId)\b/],
  ["reprise_checkpoint", /\b(?:reprise|checkpoint|repris|admission)\b/i],
];

export function bornes_identite({ cibles = [], preuves = {} } = {}) {
  const refus = [];
  let evalues = 0;
  for (const { file, text } of cibles) {
    if (!/\.(?:mjs|cjs|js|ts)$/i.test(file)) continue;
    for (const ligne of String(text).split(/\r?\n/)) {
      const entry = DECLENCHEURS.find(([, re]) => re.test(ligne));
      if (!entry) continue;
      const [nom] = entry;
      evalues += 1;
      let ok = false;
      try {
        if (nom === "borne_numerique") {
          const m = ligne.match(/(?:ttl|maxTokens?|borne|plafond)\s*[:=]\s*["']?(\d[\d_]*)["']?/i);
          const brut = m ? m[1] : "";
          const bornee = borne_numerique(brut);
          ok = bornee !== REPLI || /^\d+$/.test(brut); // repli sur valeur invalide -> REFUS
        } else {
          ok =
            PREDICATS[nom]({
              code: preuves.code ?? text,
              ligne,
              onPersist: preuves.onPersist ?? "",
              frames: preuves.frames ?? [],
              candidat: preuves.candidat,
              evenements: preuves.evenements ?? [],
              lots: preuves.lots ?? [],
            }) === true;
        }
      } catch {
        ok = false; // prédicat qui jette = REFUS, jamais un `||` toujours vrai
      }
      if (!ok) {
        const entree = { file, ligne, predicat: nom };
        if (nom === "ttl_30j_non_effondre") entree.correction = CORRECTION_TTL_30J;
        refus.push(entree);
      }
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
  return [...new Set(tout)].filter((f) => /\.(?:mjs|cjs|js|ts)$/i.test(f));
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
  // Le détecteur contient ses propres mots-déclencheurs comme données : on
  // l'exclut de l'analyse, sinon il s'auto-évalue (bruit de référence).
  const cibles = discoverTargets(worktree, base)
    .filter((f) => !f.endsWith("check-bornes-identite.mjs") && !f.includes("tests/unit/"))
    .slice(0, 1000)
    .map((file) => ({ file, text: fs.readFileSync(path.join(worktree, file), "utf8") }));
  const resultat = bornes_identite({ cibles });
  console.log(
    `bornes-identite : ${resultat.comptage.evalues} évaluée(s), ${resultat.comptage.refus} REFUS`
  );
  for (const r of resultat.refus.slice(0, 50)) {
    console.log(`REFUS ${r.predicat} ${r.file} : ${r.ligne.trim().slice(0, 160)}`);
    if (r.correction) console.log(`  ${r.correction}`);
  }
  if (!resultat.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
