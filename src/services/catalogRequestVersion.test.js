import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogRequestVersion } from "./catalogRequestVersion.js";

test("a delayed search response cannot replace a newer search result", () => {
  const requests = createCatalogRequestVersion();
  const firstSearch = requests.begin();
  const secondSearch = requests.begin();
  let visibleResults = [];

  if (requests.isCurrent(firstSearch)) visibleResults = ["first search"];
  if (requests.isCurrent(secondSearch)) visibleResults = ["second search"];

  assert.deepEqual(visibleResults, ["second search"]);
});

test("a delayed filter response cannot replace newer filters or invalidate pagination", () => {
  const requests = createCatalogRequestVersion();
  const firstFilter = requests.begin();
  const secondFilter = requests.begin();
  const paginationRequest = requests.current();

  assert.equal(requests.isCurrent(firstFilter), false);
  assert.equal(requests.isCurrent(secondFilter), true);
  assert.equal(requests.isCurrent(paginationRequest), true);

  requests.invalidate(firstFilter);
  assert.equal(requests.isCurrent(secondFilter), true);
});
