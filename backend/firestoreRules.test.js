import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Firebase emulator suite (@firebase/rules-unit-testing) is not part of this project's
// dependencies, so these tests assert the deployed rule text directly: every protected field,
// collection, and mutation path that must stay backend-only is checked by name.
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

function matchBlock(collection) {
  const start = rules.indexOf(`match /${collection}/{`);
  assert.notEqual(start, -1, `firestore.rules is missing a match block for ${collection}`);
  const lineEnd = rules.indexOf("\n", start);
  // The match line contains the (balanced) path braces plus the opening brace of the block.
  let depth = 0;
  for (let index = start; index < lineEnd; index += 1) {
    if (rules[index] === "{") depth += 1;
    if (rules[index] === "}") depth -= 1;
  }
  for (let index = lineEnd; index < rules.length; index += 1) {
    if (rules[index] === "{") depth += 1;
    if (rules[index] === "}") {
      depth -= 1;
      if (depth === 0) return rules.slice(start, index + 1);
    }
  }
  throw new Error(`Unbalanced rule block for ${collection}`);
}

const compact = (value) => value.replace(/\s+/g, " ");

test("clients cannot write phone verification state on their own user document", () => {
  const users = compact(matchBlock("users"));
  const create = users.slice(users.indexOf("allow create"), users.indexOf("allow update"));
  const update = users.slice(users.indexOf("allow update"), users.indexOf("allow delete"));
  for (const field of ["phoneVerified", "verifiedPhone", "phoneVerifiedAt", "phoneVerificationMethod"]) {
    assert.ok(create.includes(`'${field}'`), `users create rule must block ${field}`);
    assert.ok(update.includes(`'${field}'`), `users update rule must block ${field}`);
  }
  assert.ok(create.includes("hasAny("));
  assert.ok(update.includes("affectedKeys().hasAny("));
});

test("customers, vendors, and admin browsers cannot mutate orders directly", () => {
  const orders = compact(matchBlock("orders"));
  assert.ok(orders.includes("allow create, update, delete: if false;"), "orders must deny every client write");
  assert.ok(!/allow update[^;]*isAdmin\(\)/.test(orders), "orders must not allow admin browser rewrites");
  assert.ok(orders.includes("allow read: if isAdmin() || (isSignedIn() && resource.data.userId == request.auth.uid);"));
});

test("Firestore admin access allows the three admin emails and Firebase custom claims", () => {
  const start = rules.indexOf("function isAdmin()");
  assert.notEqual(start, -1);
  const end = rules.indexOf("\n    }", start);
  const adminPolicy = compact(rules.slice(start, end));
  assert.ok(adminPolicy.includes("request.auth.token.get('admin', false) == true"));
  for (const email of ["kripaldiamond@gmail.com", "harshgamerz976@gmail.com", "partswalaind@gmail.com"]) {
    assert.ok(adminPolicy.includes(`'${email}'`), `admin policy must include ${email}`);
  }
  assert.ok(adminPolicy.includes("request.auth.token.get('email', '') in ["));
});

test("review documents are public to read but backend-only to mutate", () => {
  const reviews = compact(matchBlock("reviews"));
  assert.ok(reviews.includes("allow read, create, update, delete: if false;"));
});

test("financial and lifecycle records stay backend-only", () => {
  for (const collection of ["orderFinance", "productCosts", "vendorSettlements", "coupons", "couponCampaigns", "couponCounters", "couponUsage", "adminAuditLogs", "returnRequests", "phoneVerificationEvents"]) {
    const block = compact(matchBlock(collection));
    assert.ok(/allow (create|update|delete|write|read, write)[^;]*: if false;/.test(block), `${collection} must deny client writes`);
    assert.ok(!/isAdmin\(\)\s*,/.test(block), `${collection} must not grant admin browser writes`);
  }
});

test("orderFinance keeps admin read access while denying every write", () => {
  const block = compact(matchBlock("orderFinance"));
  assert.ok(block.includes("allow read: if isAdmin();"));
  assert.ok(block.includes("allow write: if false;"));
});

test("presence reads are admin-only and signed-in users can only update their own timestamp record", () => {
  const presence = compact(matchBlock("presence"));
  assert.ok(presence.includes("allow read: if isAdmin();"));
  assert.ok(presence.includes("allow create, update: if isSignedIn() && request.auth.uid == userId"));
  assert.ok(presence.includes("keys().hasOnly(['lastSeen', 'updatedAt'])"));
  assert.ok(presence.includes("keys().hasAll(['lastSeen', 'updatedAt'])"));
  assert.ok(presence.includes("request.resource.data.lastSeen == request.time"));
  assert.ok(presence.includes("request.resource.data.updatedAt == request.time"));
  assert.ok(presence.includes("allow delete: if isSignedIn() && request.auth.uid == userId;"));
  assert.ok(!presence.includes("if true"));
});

test("unlisted collections remain denied by the catch-all", () => {
  assert.ok(rules.includes("match /{document=**}"));
  assert.ok(/match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/.test(rules));
});
