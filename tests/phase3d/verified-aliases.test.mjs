import assert from "node:assert/strict";
import test from "node:test";

import { getVerifiedEntityAlias } from "../../src/server/sports/verified-aliases.ts";

function assertAlias(alias, id, canonicalName) {
  const value = getVerifiedEntityAlias("BSD", "team", alias);
  assert.ok(value, `expected alias ${alias}`);
  assert.equal(value.providerEntityId, id);
  assert.equal(value.canonicalName, canonicalName);
}

test("aliases de times verificados usam IDs canônicos reais da BSD", () => {
  assertAlias("Bayern de Munique", 79, "FC Bayern München");
  assertAlias("Bayern Munich", 79, "FC Bayern München");
  assertAlias("Bayern München", 79, "FC Bayern München");
  assertAlias("PSG", 114, "Paris Saint-Germain");
  assertAlias("Paris SG", 114, "Paris Saint-Germain");
  assertAlias("Inter de Milão", 77, "Inter");
  assertAlias("Inter Milan", 77, "Inter");
  assertAlias("Atlético de Madrid", 54, "Atlético Madrid");
  assertAlias("Atletico Madrid", 54, "Atlético Madrid");
  assertAlias("Borussia de Dortmund", 92, "Borussia Dortmund");
});

test("Bayern conhecido nunca aponta para FC Bayern Alzenau", () => {
  for (const alias of ["Bayern de Munique", "Bayern Munich", "Bayern München"]) {
    assert.notEqual(getVerifiedEntityAlias("BSD", "team", alias)?.providerEntityId, 8160);
  }
});
