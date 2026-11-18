import test from "node:test";
import assert from "node:assert/strict";
import { borne_numerique } from "../../scripts/check/check-bornes-identite.mjs";

test("borne_numerique — nominal : entier sûr borné", () => {
  assert.equal(borne_numerique("42"), 42);
  assert.equal(borne_numerique("2147483648"), 2147483647); // Math.min INT32_MAX
});
test("borne_numerique — limite : 100_000 et 1+300 zéros -> repli", () => {
  assert.equal(borne_numerique("100_000"), 3000); // repli, PAS 100
  assert.equal(borne_numerique("1" + "0".repeat(300)), 3000); // repli, PAS Infinity
});
