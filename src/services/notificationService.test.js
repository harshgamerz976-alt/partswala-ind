import assert from "node:assert/strict";
import test from "node:test";
import {
  browserPushPreferenceKey,
  getBrowserPushPreference,
  setBrowserPushPreference,
} from "./browserPushPreferences.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("browser push consent is explicit and scoped to the signed-in account", () => {
  const storage = createStorage();
  assert.equal(getBrowserPushPreference("customer-1", storage), "unset");
  assert.notEqual(browserPushPreferenceKey("customer-1"), browserPushPreferenceKey("customer-2"));

  setBrowserPushPreference("customer-1", "enabled", storage);
  assert.equal(getBrowserPushPreference("customer-1", storage), "enabled");
  assert.equal(getBrowserPushPreference("customer-2", storage), "unset");

  setBrowserPushPreference("customer-1", "disabled", storage);
  assert.equal(getBrowserPushPreference("customer-1", storage), "disabled");
  assert.throws(() => setBrowserPushPreference("customer-1", "automatic", storage), /preference/i);
});

test("browser push preference rejects missing user identity", () => {
  assert.throws(() => browserPushPreferenceKey(""), /signed-in user/i);
  assert.throws(() => getBrowserPushPreference("", createStorage()), /signed-in user/i);
});
