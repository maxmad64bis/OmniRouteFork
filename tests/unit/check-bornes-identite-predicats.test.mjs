import test from "node:test";
import assert from "node:assert/strict";
import {
  INT32_MAX,
  REPLI,
  borne_numerique,
  borne_ttl_ms,
  TTL_30J_MS,
  ttl_30j_non_effondre,
  CORRECTION_TTL_30J,
  identite_item,
  cleanup_proprietaire,
  cle_resultat,
  reprise_checkpoint,
  PREDICATS,
  bornes_identite,
  discoverTargets,
} from "../../scripts/check/check-bornes-identite.mjs";

const WT = new URL("../..", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// 1. borne_numerique / borne-parsing-repli
// ---------------------------------------------------------------------------
test("borne_numerique — nominal : repli et plafond configurables", () => {
  assert.equal(borne_numerique("0"), REPLI); // > 0 requis
  assert.equal(borne_numerique("-5"), REPLI);
  assert.equal(borne_numerique("7", { repli: 11 }), 7);
  assert.equal(borne_numerique("9999", { plafond: 500 }), 500);
});
test("borne_numerique — limite : TTL 30 j -> INT32_MAX, jamais 1 ms", () => {
  assert.equal(borne_ttl_ms("30"), INT32_MAX);
  assert.equal(borne_ttl_ms("1" + "0".repeat(300)), REPLI);
});

test("PREDICATS — les cinq prédicats nommés sont exposés", () => {
  const noms = Object.keys(PREDICATS);
  for (const nom of [
    "borne_numerique",
    "cle_resultat",
    "cleanup_proprietaire",
    "identite_item",
    "reprise_checkpoint",
  ]) {
    assert.ok(noms.includes(nom));
  }
  assert.equal(TTL_30J_MS, 2592000000);
  assert.ok(noms.includes("ttl_30j_non_effondre"));
});

// ---------------------------------------------------------------------------
// 1c. ttl_30j_non_effondre / limite canonique « TTL 30 j -> 1 ms »
// ---------------------------------------------------------------------------
test("ttl_30j_non_effondre — nominal : TTL 30 j valide, aucun signal", () => {
  const valide = "const ttl = 30 * 86400 * 1000;";
  assert.equal(ttl_30j_non_effondre({ code: valide, ligne: valide }), true);
  const borne = "const ttl = 2147483647; // 30 * 86400 * 1000 borne INT32_MAX";
  assert.equal(ttl_30j_non_effondre({ code: borne, ligne: borne }), true);
  // Aucun faux REFUS : `ttl = 1` sans contexte 30 j n'est pas jugé.
  const sansContexte = "const ttl = 1; // cache court";
  assert.equal(ttl_30j_non_effondre({ code: sansContexte, ligne: sansContexte }), true);
  // Orchestration : aucun signal sur ces TTL légitimes (un fichier chacun).
  const r = bornes_identite({
    cibles: [
      { file: "config/ttl-valide.mjs", text: valide },
      { file: "config/ttl-borné.mjs", text: borne },
      { file: "config/ttl-court.mjs", text: sansContexte },
    ],
  });
  assert.equal(r.comptage.refus, 0);
});
test("ttl_30j_non_effondre — limite : TTL 30 j effondré à 1 ms -> REFUS nommé", () => {
  const code = "// TTL attendu : 30 * 86400 * 1000 ms\nconst ttl = 1;";
  const ligne = "const ttl = 1;";
  assert.equal(ttl_30j_non_effondre({ code, ligne }), false);
  const r = bornes_identite({ cibles: [{ file: "config/ttl.mjs", text: code }] });
  assert.equal(r.ok, false);
  assert.equal(r.comptage.refus, 1);
  assert.equal(r.refus[0].predicat, "ttl_30j_non_effondre");
  assert.equal(r.refus[0].file, "config/ttl.mjs");
  assert.equal(r.refus[0].ligne, ligne);
  assert.equal(r.refus[0].correction, CORRECTION_TTL_30J);
  assert.match(r.refus[0].correction, /86400|2592000000|node --test/);
});

// ---------------------------------------------------------------------------
// 2. identite_item / identite-choice-frames
// ---------------------------------------------------------------------------
const FRAMES_GENEREES = "const frames = matrix.map((l) => ({ choix0: l.a, choix1: l.b }));";
// (choice0 "A", choice1 stop) puis (choice0 "B", stop=choix0) -> "B" conservé.
// `stop` est un champ distinct : un choix0 dupliqué écraserait "B" en "stop".
const FRAMES_CHOIX = [
  { choix0: "A", choix1: "stop" },
  { choix0: "B", stop: "choix0" },
];

test("identite_item — nominal : la dernière frame générée gagne (B conservé)", () => {
  assert.equal(identite_item({ code: FRAMES_GENEREES, frames: FRAMES_CHOIX, candidat: "B" }), true);
});
test("identite_item — limite : frame périmée A au lieu de B -> REFUS", () => {
  assert.equal(
    identite_item({ code: FRAMES_GENEREES, frames: FRAMES_CHOIX, candidat: "A" }),
    false
  );
});
test("identite_item — limite : ID codé en dur -> REFUS", () => {
  assert.equal(
    identite_item({
      code: 'const identite = "A"; const frames = matrix.map((l) => l.a);',
      frames: FRAMES_CHOIX,
      candidat: "B",
    }),
    false
  );
});
test("identite_item — limite : suppression de frame choice-0 interdite", () => {
  assert.equal(
    identite_item({
      code: `${FRAMES_GENEREES}\nframes.splice(i, 1); // choix0 retire`,
      frames: FRAMES_CHOIX,
      candidat: "B",
    }),
    false
  );
});

// ---------------------------------------------------------------------------
// 3. cleanup_proprietaire / cleanup-owner
// ---------------------------------------------------------------------------
const CLEANUP_PROPRE =
  "if (registry.get(X) === thisSetup) registry.delete(X); refreshAndPublish();";

test("cleanup_proprietaire — nominal : garde registry.get === thisSetup", () => {
  assert.equal(cleanup_proprietaire({ code: CLEANUP_PROPRE }), true);
});
test("cleanup_proprietaire — nominal : installation unique sans existing (C-13)", () => {
  assert.equal(cleanup_proprietaire({ code: "install(); refreshAndPublish();" }), true);
});
test("cleanup_proprietaire — limite : existing.stop() domine refreshAndPublish()", () => {
  assert.equal(cleanup_proprietaire({ code: "existing.stop(); refreshAndPublish();" }), false);
});
test("cleanup_proprietaire — limite : ancien cleanup modifie le successeur", () => {
  assert.equal(
    cleanup_proprietaire({
      code: CLEANUP_PROPRE,
      evenements: [{ proprietaire: "successeur", cleanupPar: "ancien" }],
    }),
    false
  );
});

// ---------------------------------------------------------------------------
// 4. cle_resultat / cle-resultat-filtree
// ---------------------------------------------------------------------------
const CODE_CLE = "const rows = getAllAccessTokens(toutes).filter((r) => r.connectionId);";
const ON_PERSIST_OK =
  "const onPersist = async (x) => { if (!(await save(x))) throw new Error('no'); return true; };";

test("cle_resultat — nominal : clé filtrée + Promise<boolean> gardée", () => {
  assert.equal(cle_resultat({ code: CODE_CLE, onPersist: ON_PERSIST_OK }), true);
});
test("cle_resultat — limite : repli ?? '' -> REFUS", () => {
  assert.equal(
    cle_resultat({ code: "const cid = row.connectionId ?? '';", onPersist: ON_PERSIST_OK }),
    false
  );
});
test("cle_resultat — limite : callback nu -> REFUS", () => {
  assert.equal(cle_resultat({ code: CODE_CLE, onPersist: "const onPersist = save;" }), false);
});
test("cle_resultat — limite : getAllAccessTokens sans filtre -> REFUS", () => {
  assert.equal(
    cle_resultat({ code: "const rows = getAllAccessTokens(toutes);", onPersist: ON_PERSIST_OK }),
    false
  );
});

// ---------------------------------------------------------------------------
// 5. reprise_checkpoint / reprise-compte-intact
// ---------------------------------------------------------------------------
test("reprise_checkpoint — nominal : lot repris > limite, compte intact", () => {
  assert.equal(
    reprise_checkpoint({
      code: "if (lot.repris) compte += 1;",
      lots: [{ repris: true, admission: false, compteEcrase: false }],
    }),
    true
  );
});
test("reprise_checkpoint — limite : admission sur lot repris -> REFUS", () => {
  assert.equal(
    reprise_checkpoint({
      code: "if (lot.repris) compte += 1;",
      lots: [{ repris: true, admission: true, compteEcrase: false }],
    }),
    false
  );
});
test("reprise_checkpoint — limite : compte écrasé -> REFUS", () => {
  assert.equal(
    reprise_checkpoint({
      code: "if (lot.repris) compte += 1;",
      lots: [{ repris: true, compteEcrase: true }],
    }),
    false
  );
});
test("reprise_checkpoint — limite : compte = 0 sans incrément -> REFUS", () => {
  assert.equal(reprise_checkpoint({ code: "compte = 0;" }), false);
});

// ---------------------------------------------------------------------------
// Orchestration + découverte dynamique
// ---------------------------------------------------------------------------
test("bornes_identite — lot propre : 0 REFUS", () => {
  const r = bornes_identite({ cibles: [{ file: "x.mjs", text: 'const ttl = "42";' }] });
  assert.equal(r.ok, true);
  assert.equal(r.comptage.refus, 0);
});
test("bornes_identite — repli invalide : 1 REFUS borne_numerique", () => {
  const r = bornes_identite({ cibles: [{ file: "x.mjs", text: 'const ttl = "100_000";' }] });
  assert.equal(r.ok, false);
  assert.equal(r.comptage.refus, 1);
  assert.equal(r.refus[0].predicat, "borne_numerique");
});
test("discoverTargets — diff BASE + non suivis, jamais git diff nu", () => {
  const cibles = discoverTargets(WT, "upstream/release/v3.8.55");
  assert.ok(cibles.includes("scripts/check/check-bornes-identite.mjs"));
});
