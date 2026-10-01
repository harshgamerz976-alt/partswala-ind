import test from "node:test";
import assert from "node:assert/strict";
import { withGeminiGroqFallback } from "./brain.js";

test("temporary Gemini overload falls back to Groq exactly once", async () => {
  let groqCalls = 0;
  const result = await withGeminiGroqFallback({
    generateGemini: async () => { throw new Error("503 UNAVAILABLE: high demand"); },
    generateGroq: async () => { groqCalls += 1; return "{\"action\":\"searchProducts\"}"; },
    groqAvailable: true,
  });
  assert.equal(result, "{\"action\":\"searchProducts\"}");
  assert.equal(groqCalls, 1);
});

test("non-capacity Gemini errors do not fall back to Groq", async () => {
  let groqCalls = 0;
  await assert.rejects(withGeminiGroqFallback({
    generateGemini: async () => { throw new Error("401 invalid API key"); },
    generateGroq: async () => { groqCalls += 1; return "{}"; },
    groqAvailable: true,
  }), /401 invalid API key/);
  assert.equal(groqCalls, 0);
});

test("Gemini overload remains an error if the Groq key is not configured", async () => {
  await assert.rejects(withGeminiGroqFallback({
    generateGemini: async () => { throw new Error("429 RESOURCE_EXHAUSTED"); },
    generateGroq: async () => "{}",
    groqAvailable: false,
  }), /429 RESOURCE_EXHAUSTED/);
});