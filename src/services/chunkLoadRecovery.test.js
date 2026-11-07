import test from "node:test";
import assert from "node:assert/strict";
import { registerChunkLoadRecovery } from "./chunkLoadRecovery.js";

function createWindowStub() {
  const listeners = new Map();
  const storedValues = new Map();
  let reloadCount = 0;
  return {
    addEventListener: (type, listener) => listeners.set(type, listener),
    sessionStorage: {
      getItem: (key) => storedValues.get(key) ?? null,
      setItem: (key, value) => storedValues.set(key, value),
    },
    location: { reload: () => { reloadCount += 1; } },
    dispatch: (event) => listeners.get(event.type)?.(event),
    get reloadCount() { return reloadCount; },
  };
}

test("a failed lazy chunk triggers one recovery reload per chunk and tab session", () => {
  const targetWindow = createWindowStub();
  registerChunkLoadRecovery(targetWindow);
  const event = {
    type: "vite:preloadError",
    payload: { request: "/assets/Login-previous.js" },
    preventDefault() { this.prevented = true; },
  };

  targetWindow.dispatch(event);
  assert.equal(event.prevented, true);
  assert.equal(targetWindow.reloadCount, 1);

  const repeatedEvent = {
    type: "vite:preloadError",
    payload: { request: "/assets/Login-previous.js" },
    preventDefault() { this.prevented = true; },
  };
  targetWindow.dispatch(repeatedEvent);
  assert.equal(repeatedEvent.prevented, undefined);
  assert.equal(targetWindow.reloadCount, 1);
});
