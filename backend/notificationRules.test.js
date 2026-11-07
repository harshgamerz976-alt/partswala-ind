import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("notification history is readable only by its owner and backend-only to mutate", () => {
  assert.match(rules, /match \/notifications\/\{notificationId\} \{\s*allow read: if isSignedIn\(\) && request\.auth\.uid == userId;\s*allow write: if false;/);
  assert.match(rules, /match \/fcmTokens\/\{tokenId\} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/fcmTokenOwners\/\{tokenId\} \{\s*allow read, write: if false;/);
});
