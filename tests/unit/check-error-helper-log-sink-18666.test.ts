// T13 (lot fork) — LOG_SINK, détecteur DISTINCT de l'ancre de suppression.
//
// L'ancre INTERNAL_SINK_CALL (check-error-helper.mjs) reste TELLE QUELLE : elle vaut
// true sur `log.error("BATCHES", "sweep failed", {` (faux positif historique corrigé
// puis retiré de la allowlist, gardé par check-error-helper-false-positives-15159).
// LOG_SINK porte, lui, sur l'ARGUMENT MESSAGE (2e argument) et refuse une erreur brute
// interpolée dans le message — y compris avec `?.` après la méthode (CR-C1).
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error — .mjs gate module has no type declarations; runtime shape is known.
import { LOG_SINK } from "../../scripts/check/check-error-helper.mjs";

test("LOG_SINK — nominal : ancrage de suppression intact (faux positif historique)", () => {
  assert.equal(LOG_SINK('log.error("BATCHES", "sweep failed", {'), true); // ancre = vert
  assert.equal(LOG_SINK('log.error("x", key)'), true); // clé, pas erreur = vert
});

test("LOG_SINK — limite : message-first avec erreur brute -> REFUS", () => {
  assert.equal(LOG_SINK('log?.error?.("TOKEN_REFRESH", `Bulk …${proxyErr.message}`)'), false);
});

test("LOG_SINK — sink-sanitise : sanitizeErrorMessage dans le message -> vert", () => {
  assert.equal(
    LOG_SINK('log.error("TOKEN_REFRESH", `refresh failed: ${sanitizeErrorMessage(err)}`)'),
    true
  );
});
