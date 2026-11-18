import test from "node:test";
import assert from "node:assert/strict";
import { verdicts_alignes } from "../../scripts/check/check-doc-code-parite.mjs";

test("verdicts_alignes — nominal : les deux verdicts lus dans le CODE", () => {
  const code = "preview -> rate_limit; failover -> quota_exhausted";
  const changelog = "verdicts now agree"; // mensonge : ne doit PAS être la source
  assert.equal(verdicts_alignes({ code, changelog }), true);
});
test("verdicts_alignes — limite : un seul verdict -> REFUS", () => {
  assert.equal(
    verdicts_alignes({ code: "preview -> rate_limit", changelog: "verdicts now agree" }),
    false
  );
});
