import test from "node:test";
import assert from "node:assert/strict";
import { verifierInvariants } from "../../scripts/check/verif-invariants-fonctionnels.mjs";

test("regex_frontiere_propriete — nominal : ECONNRESET -> retry (pas de signal)", () => {
  const d = [{ path: "a.ts", line: 'if (err.code === "ECONNRESET") retry();' }];
  assert.equal(
    verifierInvariants(d).some((r) => r.predicat === "regex_frontiere_propriete"),
    false
  );
});

test("regex_frontiere_propriete — limite : erreur de propriete -> pas de retry (REFUS)", () => {
  const d = [{ path: "a.ts", line: "if (/ECONNRESET/.test(err.message)) retry();" }];
  assert.equal(
    verifierInvariants(d).some((r) => r.predicat === "regex_frontiere_propriete"),
    true
  );
});
