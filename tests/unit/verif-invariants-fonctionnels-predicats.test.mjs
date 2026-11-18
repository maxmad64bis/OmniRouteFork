import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  verifierInvariants,
  whitespaceTrimSet,
  discoverTargets,
  NOMS_PREDICATS,
  PREDICATS,
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
} from "../../scripts/check/verif-invariants-fonctionnels.mjs";

const d = (...lignes) => lignes.map((line, i) => ({ path: "src/a.ts", line, numero: i + 1 }));
const a = (diff, predicat) => verifierInvariants(diff).some((r) => r.predicat === predicat);

// === 0. Surface : exactement 12 prédicats nommés ============================
test("surface — les 12 prédicats nommés sont exposés", () => {
  const attendus = [
    "compteur_egale_parseur",
    "parite_sonde_executeur",
    "denominateur_complet",
    "regex_frontiere_propriete",
    "emission_apres_sink",
    "attente_active",
    "display_name_golden",
    "source_garde_avant_predicat",
    "normalisation_prefixe_gardee",
    "horloge_activite_rafraichie",
    "assertion_payload_publie",
    "test_hygiene",
  ];
  assert.equal(NOMS_PREDICATS.length, 12);
  assert.deepEqual([...NOMS_PREDICATS].sort(), [...attendus].sort());
  assert.equal(Object.keys(PREDICATS).length, 12);
});

// === 1. compteur_egale_parseur (CR-A1) =====================================
test("compteur_egale_parseur — découverte runtime des blancs trim() (U+00A0 inclus, aucun codage en dur)", () => {
  const ws = whitespaceTrimSet();
  assert.equal(ws.has("\u00a0"), true, "NBSP doit être découvert par trim() au runtime");
  assert.equal(ws.has(" "), true);
  assert.equal(ws.has("\t"), true);
  assert.equal(ws.has("\u200b"), false, "le zéro-width space n'est pas un blanc pour trim()");
});

test("compteur_egale_parseur — nominal : 5 lignes + U+00A0 -> 5 (compte aligné sur trim/parseur)", () => {
  const diff = d(
    'const brut = "l1\\nl2\\nl3\\nl4\\nl5\\n\\u00a0";',
    'const total = brut.split("\\n").filter(l => l.trim().length > 0).length;',
    "const data = JSON.parse(brut);"
  );
  assert.equal(a(diff, "compteur_egale_parseur"), false);
});

test("compteur_egale_parseur — limite : échec de validation JSON sous limite, total persisté 5", () => {
  const diff = d(
    'const total = brut.split("\\n").length;',
    "if (!validate(brut)) throw new Error('invalid');"
  );
  assert.equal(a(diff, "compteur_egale_parseur"), true);
  assert.equal(compteur_egale_parseur(diff)[0].correction.includes("parseur"), true);
});

// === 2. parite_sonde_executeur (CR-A6) =====================================
test("parite_sonde_executeur — nominal : clé fournie, même Bearer des deux côtés", () => {
  const diff = d('const sonde = "Bearer " + apiKey;', "const execut = `Bearer ${apiKey}`;");
  assert.equal(a(diff, "parite_sonde_executeur"), false);
});

test("parite_sonde_executeur — nominal : Kilo sans clé -> Bearer anonymous des deux côtés", () => {
  const diff = d('const sonde = "Bearer anonymous";', 'const execut = "Bearer anonymous";');
  assert.equal(a(diff, "parite_sonde_executeur"), false);
});

test("parite_sonde_executeur — limite : clé d'un côté, anonymous de l'autre -> REFUS", () => {
  const diff = d('const sonde = "Bearer " + apiKey;', 'const execut = "Bearer anonymous";');
  assert.equal(a(diff, "parite_sonde_executeur"), true);
});

// === 3. denominateur_complet (CR-A9) =======================================
test("denominateur_complet — nominal : 3 tentatives non filtrées -> 1/3", () => {
  const diff = d(
    "const tentatives = [1, 2, 3];",
    "console.log(`${attempt}/${tentatives.length}`);"
  );
  assert.equal(a(diff, "denominateur_complet"), false);
});

test("denominateur_complet — limite : filtre ne renvoyant que la tentative 1 -> rang seul", () => {
  const diff = d("console.log(`${attempt}/${tentatives.filter(t => t.ok).length}`);");
  assert.equal(a(diff, "denominateur_complet"), true);
});

test("denominateur_complet — limite : cap 300 -> dénominateur partiel", () => {
  const diff = d("console.log(`${attempt}/${Math.min(total, 300)}`);");
  assert.equal(a(diff, "denominateur_complet"), true);
});

// === 4. regex_frontiere_propriete (CR-A12) — ancrage panne.js ==============
test("regex_frontiere_propriete — nominal : ECONNRESET (code) -> retry, pas de signal", () => {
  const diff = d('if (err.code === "ECONNRESET") retry();');
  assert.equal(a(diff, "regex_frontiere_propriete"), false);
});

test("regex_frontiere_propriete — limite : erreur de propriété sur message -> pas de retry (REFUS)", () => {
  const diff = d("if (/ECONNRESET/.test(err.message)) retry();");
  assert.equal(a(diff, "regex_frontiere_propriete"), true);
  assert.equal(regex_frontiere_propriete(diff)[0].correction.includes("reading 'network'"), true);
});

// === 5. emission_apres_sink (CR-A13) =======================================
test("emission_apres_sink — nominal : log émis après setHostSink", () => {
  const diff = d("setHostSink(sink);", "ctx.client.app.log('warn', 'ready');");
  assert.equal(a(diff, "emission_apres_sink"), false);
});

test("emission_apres_sink — limite : appel avant le sink + setup sans ctx.client.app.log -> REFUS", () => {
  const diff = d(
    "function firstSetup(ctx) { /* pas de ctx.client.app.log */ }",
    "ctx.client.app.log('warn', 'early');",
    "setHostSink(sink);"
  );
  assert.equal(a(diff, "emission_apres_sink"), true);
});

// === 6. attente_active (CR-C3) =============================================
test("attente_active — nominal : setImmediate hors boucle -> vert", () => {
  const diff = d("setImmediate(flush);");
  assert.equal(a(diff, "attente_active"), false);
});

test("attente_active — nominal : boucle avec waiters.push(resolve) -> vert", () => {
  const diff = d(
    "while (waiters.length) {",
    "  waiters.push(resolve);",
    "  await new Promise(r => setImmediate(r));",
    "}"
  );
  assert.equal(a(diff, "attente_active"), false);
});

test("attente_active — limite : await new Promise(setImmediate) dans un while de worker -> REFUS", () => {
  const diff = d("while (worker.busy) {", "  await new Promise(r => setImmediate(r));", "}");
  assert.equal(a(diff, "attente_active"), true);
});

// === 7. display_name_golden (CR-C11/CR-C12, PR 18230) ======================
test("display_name_golden — table réelle lue au runtime (readdir + JSON.parse, 3 cas)", () => {
  const garde = d(
    "const name = buildModelDisplayName(combo);",
    "if (name.startsWith(prefix)) name = name.slice(prefix.length);"
  );
  assert.equal(
    a(garde, "display_name_golden"),
    false,
    "table non vide + strip gardé -> pas de signal"
  );
  const naif = d("publishCombos(c);", "const short = name.replace(/^.* - /, '');");
  assert.equal(a(naif, "display_name_golden"), true);
  assert.equal(display_name_golden(naif)[0].correction.includes("GPT-4 - Turbo preview"), true);
});

test("display_name_golden — nominal : combo sans name ni rawModelId garde son nom", () => {
  const diff = d(
    "const name = buildModelDisplayName(combo);",
    "if (name.startsWith(prefix)) name = name.slice(prefix.length);"
  );
  assert.equal(a(diff, "display_name_golden"), false);
});

test("display_name_golden — limite : strip naïf casse GPT-4 - Turbo preview -> REFUS", () => {
  const diff = d(
    "const name = buildModelDisplayName(combo);",
    "const short = name.replace(/^.* - /, '');"
  );
  const signaux = display_name_golden(diff);
  assert.equal(signaux.length > 0, true);
  assert.equal(
    signaux[0].correction.includes("GPT-4 - Turbo preview"),
    true,
    "le nom vient de la table, pas du code"
  );
});

test("display_name_golden — VB-4 : table ABSENTE -> REFUS immédiat", () => {
  const dirAbsent = "/tmp/opencode/t14-goldens-absents";
  const diff = d("const name = buildModelDisplayName(combo);");
  const signaux = display_name_golden(diff, { goldensDir: dirAbsent });
  assert.equal(signaux.length, 1);
  assert.equal(signaux[0].correction.includes("VB-4"), true);
});

test("display_name_golden — VB-4 : table VIDE -> REFUS immédiat", () => {
  const diff = d("const name = buildModelDisplayName(combo);");
  const signaux = display_name_golden(diff, { goldensDir: "/tmp/opencode" });
  assert.equal(signaux.length, 1);
  assert.equal(signaux[0].line, "(table absente ou vide)");
});

// === 8. source_garde_avant_predicat (CR-B4/F4) =============================
test("source_garde_avant_predicat — nominal : source par défaut testée avant isUserComboRow", () => {
  const diff = d(
    "if (combosSource === 'models') {",
    "  expect(isUserComboRow('kg/auto-fallback')).toBe(false);",
    "}"
  );
  assert.equal(a(diff, "source_garde_avant_predicat"), false);
});

test("source_garde_avant_predicat — limite : garde après le prédicat -> REFUS", () => {
  const diff = d(
    "expect(isUserComboRow('kg/auto-fallback')).toBe(false);",
    "combosSource: 'models'",
    "if (combosSource === 'models') { /* tard */ }"
  );
  assert.equal(a(diff, "source_garde_avant_predicat"), true);
});

// === 9. normalisation_prefixe_gardee (CR-B6/F6) ============================
test("normalisation_prefixe_gardee — nominal : startsWith avant replace, entrée sans préfixe rejetée", () => {
  const diff = d(
    "if (!name.startsWith('package/')) throw new Error('bad tarball');",
    "name = name.replace('package/', '');"
  );
  assert.equal(a(diff, "normalisation_prefixe_gardee"), false);
});

test("normalisation_prefixe_gardee — limite : replace seul -> REFUS", () => {
  const diff = d("name = name.replace('package/', '');");
  assert.equal(a(diff, "normalisation_prefixe_gardee"), true);
});

// === 10. horloge_activite_rafraichie (CR-B7/F7) ============================
test("horloge_activite_rafraichie — nominal : 3 écritures démarrage/release/finally", () => {
  const diff = d(
    "this.lastActivityAt = Date.now(); // démarrage",
    "release(): this.lastActivityAt = Date.now();",
    "finally { this.lastActivityAt = Date.now(); noteStreamableInflight(-1); }"
  );
  assert.equal(a(diff, "horloge_activite_rafraichie"), false);
});

test("horloge_activite_rafraichie — limite : une seule écriture au démarrage -> REFUS", () => {
  const diff = d("this.lastActivityAt = Date.now(); // démarrage");
  const signaux = horloge_activite_rafraichie(diff);
  assert.equal(signaux.length > 0, true);
  assert.equal(signaux[0].correction.includes("3"), true);
});

// === 11. assertion_payload_publie (CR-B3/F3) ==============================
test("assertion_payload_publie — nominal : assert(... 'm1') présent", () => {
  const diff = d("assert.equal(payload.model, 'm1');", "const provider = 'openai';");
  assert.equal(a(diff, "assertion_payload_publie"), false);
});

test("assertion_payload_publie — limite : assert sur le seul nom de provider -> REFUS", () => {
  const diff = d("assert.equal(payload.provider, 'openai');");
  assert.equal(a(diff, "assertion_payload_publie"), true);
});

// === 12. test_hygiene (CR-A4/A7/A8/A9/A12, B8/B12, C6/C10) ================
test("test_hygiene — nominal : mock en 2e argument, waitFor, return après assert", () => {
  const diff = d(
    "const fakeMock = makeMock();",
    "const sut = build(fakeMock, opts);",
    "await waitFor(() => sut.ready);",
    "assert.equal(sut.ok, true);",
    "return;"
  );
  assert.equal(a(diff, "test_hygiene"), false);
});

test("test_hygiene — nominal : setTimeout dans Promise.race de garde -> vert", () => {
  const diff = d(
    "await Promise.race([done, new Promise(r => setTimeout(r, 200))]);",
    "assert.ok(true);"
  );
  assert.equal(a(diff, "test_hygiene"), false);
});

test("test_hygiene — limite : return; avant assert -> REFUS", () => {
  const diff = d("if (skip) return;", "assert.equal(x, 1);");
  assert.equal(a(diff, "test_hygiene"), true);
});

test("test_hygiene — limite : mock non passé au SUT -> REFUS", () => {
  const diff = d("const fakeMock = makeMock();", "const sut = build(fakeMock);", "assert.ok(sut);");
  assert.equal(a(diff, "test_hygiene"), true);
});

test("test_hygiene — limite : expect(x.some(...)).toBe(false) sans lien -> REFUS", () => {
  const diff = d("expect(rows.some(r => r === 1)).toBe(false);");
  assert.equal(a(diff, "test_hygiene"), true);
});

test("test_hygiene — limite : setTimeout(assert, 200) post-tick() sans garde -> REFUS", () => {
  const diff = d("tick();", "setTimeout(() => assert.equal(x, 1), 200);");
  assert.equal(a(diff, "test_hygiene"), true);
});

// === Orchestration & découverte dynamique =================================
test("orchestration — signal = prédicat + chemin + ligne, sortie bornée", () => {
  const signaux = verifierInvariants(d("if (/ECONNRESET/.test(err.message)) retry();"));
  assert.equal(signaux.length >= 1, true);
  assert.equal(signaux[0].predicat, "regex_frontiere_propriete");
  assert.equal(typeof signaux[0].path, "string");
  assert.equal(typeof signaux[0].line, "string");
  assert.equal(verifierInvariants([]).length, 0);
});

test("découverte — git diff $BASE --name-only + ls-files, jamais git diff nu", () => {
  const cibles = discoverTargets(process.cwd(), "upstream/release/v3.8.55");
  assert.equal(Array.isArray(cibles), true);
  assert.equal(cibles.includes("scripts/check/verif-invariants-fonctionnels.mjs"), true);
});

test("Step 3 — node --import tsx/esm charge le substrat TS de découverte des blancs", () => {
  const sortie = execFileSync(
    "node",
    [
      "--import",
      "tsx/esm",
      "-e",
      'import("./scripts/check/verif-invariants-substrat.ts").then(m => console.log("SUBSTRAT_OK nb=" + m.whitespaceTrimSet().has(0x00a0)))',
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
  assert.match(sortie, /SUBSTRAT_OK nb=true/);
});
