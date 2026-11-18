// T11 Step 4 — rejeu : chaque REFUS de la table des 8 prédicats a un cas d'échec
// EXÉCUTÉ (AR16). Aucun `||` toujours vrai, aucun test qui grepe une consigne.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  ANCRAGE_RE,
  verdicts_alignes,
  id_classe_par_le_predicat,
  durabilite_stockage_partage,
  durabilite_optout_nomme,
  durabilite_rehydratation_active,
  chiffre_mesure,
  corps_pr_renseigne,
  ecriture_transactionnelle,
  doc_code_parite,
} from "../../scripts/check/check-doc-code-parite.mjs";

// --- 1. verdicts_alignes ----------------------------------------------------
test("verdicts_alignes — VB-2 : le changelog ment, les deux verdicts viennent du CODE", () => {
  assert.equal(
    verdicts_alignes({
      code: "preview -> rate_limit; failover -> quota_exhausted",
      changelog: "verdicts now agree",
    }),
    true
  );
});
test("verdicts_alignes — REFUS : un seul verdict asserté", () => {
  assert.equal(
    verdicts_alignes({
      code: "preview -> rate_limit",
      changelog: "verdicts now agree",
    }),
    false
  );
});
test("verdicts_alignes — REFUS : l'affirmation dit « agree » mais les verdicts diffèrent", () => {
  assert.equal(
    verdicts_alignes({
      code: "rate_limit / quota_exhausted",
      affirmation: "verdicts now agree",
    }),
    false
  );
});

// --- 2. id_classe_par_le_predicat -------------------------------------------
const ID_ROUTER_DOC = "Entrée `router` : `openrouter/auto` dans le README";
const ID_ROUTER_CODE =
  "export function isRouterEntryId(id) { return id.includes('openrouter/auto'); }";
test("id_classe_par_le_predicat — nominal : isRouterEntryId reconnaît l'ID documenté", () => {
  assert.equal(id_classe_par_le_predicat({ doc: ID_ROUTER_DOC, code: ID_ROUTER_CODE }), true);
});
test("id_classe_par_le_predicat — REFUS : ID documenté absent du code", () => {
  assert.equal(
    id_classe_par_le_predicat({
      doc: ID_ROUTER_DOC,
      code: "isRouterEntryId(id) => false // gpt-4o",
    }),
    false
  );
});
test("id_classe_par_le_predicat — REFUS : ID direct non reconnu comme entrée router", () => {
  assert.equal(
    id_classe_par_le_predicat({
      doc: "Modèle `router` : `gpt-4o`",
      code: "gpt-4o isRouterEntryId",
    }),
    false
  );
});

// --- 3. durabilite_stockage_partage (indépendant de l'opt-out : C-19) --------
test("durabilite_stockage_partage — nominal : DATA_DIR partagé", () => {
  assert.equal(
    durabilite_stockage_partage({
      doc: "Après restart, storage.sqlite est conservé",
      code: "const dir = process.env.DATA_DIR || resolveHome();",
    }),
    true
  );
});
test("durabilite_stockage_partage — REFUS : mention sans stockage partagé", () => {
  assert.equal(
    durabilite_stockage_partage({ doc: "Après restart", code: "const dir = tmpdir();" }),
    false
  );
});
test("durabilite_stockage_partage — C-19 : opt-out seul ne suffit PAS (indépendance)", () => {
  assert.equal(
    durabilite_stockage_partage({
      doc: "OPT_OUT_CACHE après restart",
      code: "process.env.OPT_OUT_CACHE",
    }),
    false
  );
});

// --- 4. durabilite_optout_nomme ---------------------------------------------
test("durabilite_optout_nomme — nominal : variable nommée et LUE dans le code", () => {
  assert.equal(
    durabilite_optout_nomme({
      doc: "Variable OPT_OUT_CACHE",
      code: "if (process.env.OPT_OUT_CACHE) return;",
    }),
    true
  );
});
test("durabilite_optout_nomme — REFUS : variable absente du code", () => {
  assert.equal(
    durabilite_optout_nomme({
      doc: "Variable OPT_OUT_CACHE",
      code: "if (process.env.OTHER) return;",
    }),
    false
  );
});

// --- 5. durabilite_rehydratation_active -------------------------------------
const CCR_OK =
  "export function retrieveBlock(h) { return cache.get(h); }\n" +
  "export function inspectCcrBlock(args) { const b = retrieveBlock(args.hash); if (!found) return null; return b; }";
const CCR_REFUS =
  "export function retrieveBlock(h) { return cache.get(h); }\n" +
  "export function inspectCcrBlock(args) { if (!found) return null; const b = retrieveBlock(args.hash); return b; }";
test("durabilite_rehydratation_active — nominal : retrieveBlock AVANT l'early-return", () => {
  assert.equal(durabilite_rehydratation_active({ code: CCR_OK }), true);
});
test("durabilite_rehydratation_active — REFUS : early-return AVANT réhydratation", () => {
  assert.equal(durabilite_rehydratation_active({ code: CCR_REFUS }), false);
});
test("durabilite_rehydratation_active — C-20 : handler sans retrieveBlock n'est PAS la source de l'ordre", () => {
  assert.equal(
    durabilite_rehydratation_active({
      code: CCR_OK,
      handler: "compressionTools.ts : aucun retrieveBlock ici",
    }),
    true
  );
});

// --- 6. chiffre_mesure -------------------------------------------------------
test("chiffre_mesure — nominal : source mesurée citée", () => {
  assert.equal(chiffre_mesure({ doc: "12 ms (source : CI, ci.yml:42)" }), true);
});
test("chiffre_mesure — nominal : marqueur SELON AUTEUR", () => {
  assert.equal(chiffre_mesure({ doc: "12 ms SELON AUTEUR" }), true);
});
test("chiffre_mesure — REFUS : chiffre nu non mesuré", () => {
  assert.equal(chiffre_mesure({ doc: "12 ms de Latence" }), false);
});

// --- 7. corps_pr_renseigne (VB-3 : logique corrigée) -------------------------
test("corps_pr_renseigne — nominal : TOUTES les cases cochées ET issue liée", () => {
  assert.equal(corps_pr_renseigne({ corps: "- [x] A\n- [x] B\nCloses #20462" }), true);
});
test("corps_pr_renseigne — nominal : mention explicite « aucun issue lié »", () => {
  assert.equal(corps_pr_renseigne({ corps: "- [x] A\n- [x] B\naucun issue lié" }), true);
});
test("corps_pr_renseigne — REFUS : une case non cochée", () => {
  assert.equal(corps_pr_renseigne({ corps: "- [x] A\n- [ ] B\nCloses #20462" }), false);
});
test("corps_pr_renseigne — REFUS : aucune issue (VB-3, ancienne logique inversée)", () => {
  assert.equal(corps_pr_renseigne({ corps: "- [x] A\n- [x] B\n(description seule)" }), false);
});

// --- 8. ecriture_transactionnelle -------------------------------------------
const RMW_OK =
  "db.transaction(async tx => { const cur = await tx.query('SELECT cooldown FROM t'); await tx.query('UPDATE t SET cooldown = ?'); });";
test("ecriture_transactionnelle — nominal : lecture DANS la transaction + écriture ciblée", () => {
  assert.equal(ecriture_transactionnelle({ code: RMW_OK }), true);
});
test("ecriture_transactionnelle — REFUS : RMW hors transaction", () => {
  assert.equal(
    ecriture_transactionnelle({
      code: "const cur = await db.query('SELECT cooldown FROM t'); await db.query('UPDATE t SET cooldown = ?');",
    }),
    false
  );
});
test("ecriture_transactionnelle — REFUS : cooldown modifié pendant le vol", () => {
  assert.equal(ecriture_transactionnelle({ code: "cooldown += 1; " + RMW_OK }), false);
});

// --- Orchestration + frontière de segment (Step 2) --------------------------
test("doc_code_parite — un REFUS verdicts_alignes est bien compté (marqueur sans effet)", () => {
  const r = doc_code_parite({
    docs: [{ file: "changelog.d/20462.md", text: "verdicts now agree" }],
    preuves: { code: "preview -> rate_limit; failover -> quota_exhausted" },
  });
  assert.equal(r.ok, false);
  assert.equal(r.comptage.refus, 1);
  assert.equal(r.refus[0].predicat, "verdicts_alignes");
});
test("doc_code_parite — SELON AUTEUR exempt un chiffre mais PAS verdicts_alignes (VB-2)", () => {
  const r = doc_code_parite({
    docs: [
      { file: "docs/a.md", text: "12 ms SELON AUTEUR" },
      { file: "docs/b.md", text: "verdicts now agree SELON AUTEUR" },
    ],
    preuves: { code: "rate_limit quota_exhausted" },
  });
  assert.equal(
    r.refus.some((x) => x.predicat === "verdicts_alignes"),
    true
  );
  assert.equal(
    r.refus.some((x) => x.predicat === "chiffre_mesure"),
    false
  );
});
test("ANCRAGE_RE — regex MAINTENANCE.md:212 telle quelle : ci.yml:42-43 capturé", () => {
  const m = ".github/workflows/ci.yml:42-43".match(ANCRAGE_RE);
  assert.ok(m);
  assert.equal(m[1], ".github/workflows/ci.yml");
  assert.equal(m[2], "42"); // \b final, PAS de (?![-\w]) → '-43' ne bloque pas
});
test("ANCRAGE_RE — lookbehind : encoder-decoder.ts:12 capturé en entier", () => {
  const m = "encoder-decoder.ts:12".match(ANCRAGE_RE);
  assert.ok(m);
  assert.equal(m[1], "encoder-decoder.ts");
});

// --- Step 3 — exécution TS par node --import tsx/esm (sortie bornée) --------
test("Step 3 — node --import tsx/esm charge le prédicat TS (one-liner nu insuffisant en C-22)", () => {
  const out = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx/esm",
      "-e",
      'import("./scripts/check/doc-code-parite-router-id.ts").then(m => console.log(String(m.isRouterEntryId("openrouter/auto"))))',
    ],
    { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8" }
  ).slice(0, 200);
  assert.match(out, /^true/);
});
