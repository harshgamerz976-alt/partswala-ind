import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("legal acceptance audit records are inaccessible to browser clients", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/legalAcceptances\/\{acceptanceId\} \{\s*allow read, write: if false;/);
});
