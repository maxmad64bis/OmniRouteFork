// T13 (lot fork) — erreur_non_sanitifiee : un catch de boucle de refresh qui neutralise
// son résultat (`rows = null`) SANS journaliser l'erreur via sanitizeErrorMessage est
// un signal (G5 : « tout catch de bulk journalise »). Prédicat factorisé avec LOG_SINK :
// la lecture de l'appel log.* et de son argument message est partagée.
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error — .mjs gate module has no type declarations; runtime shape is known.
import { erreur_non_sanitifiee } from "../../scripts/check/check-error-helper.mjs";

test("erreur_non_sanitifiee — nominal : bulk journalisé via sanitizeErrorMessage -> vert", () => {
  const src = `async function refreshTokens() {
    try {
      rows = await fetchRows();
    } catch (err) {
      log.error("TOKEN_REFRESH", \`bulk refresh failed: \${sanitizeErrorMessage(err)}\`);
      rows = null;
    }
    return rows;
  }`;
  assert.equal(erreur_non_sanitifiee(src), false);
});

test("erreur_non_sanitifiee — limite : catch qui assigne null sans log -> REFUS", () => {
  const src = `async function refreshTokens() {
    try {
      rows = await fetchRows();
    } catch (e) {
      rows = null;
    }
    return rows;
  }`;
  assert.equal(erreur_non_sanitifiee(src), true);
});

test("erreur_non_sanitifiee — limite : log avec erreur brute (non sanitizée) -> REFUS", () => {
  const src = `catch (e) {
    log?.error?.("TOKEN_REFRESH", \`bulk \${e.message}\`);
    rows = null;
  }`;
  assert.equal(erreur_non_sanitifiee(src), true);
});
