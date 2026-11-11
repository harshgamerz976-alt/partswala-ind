import test from "node:test";
import assert from "node:assert/strict";
import { buildAssistantPrompt, normalizeIntent, withGeminiGroqFallback } from "./brain.js";

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

test("WhatsApp intent extraction leaves unstated quantity missing without changing web defaults", () => {
  const whatsappIntent = normalizeIntent({
    action: "answer",
    args: { partName: "clutch", vehicle: { manufacturer: "Tata" } },
  }, ["answer"], "whatsapp");
  assert.equal(whatsappIntent.args.quantity, 0);
  assert.equal(whatsappIntent.args.partName, "clutch");
  assert.equal(whatsappIntent.args.vehicle.manufacturer, "Tata");

  const webIntent = normalizeIntent({ action: "answer", args: {} }, ["answer"]);
  assert.equal(webIntent.args.quantity, 1);
});

test("assistant prompt carries the WhatsApp display name as bounded customer context only", () => {
  const prompt = JSON.parse(buildAssistantPrompt({
    message: "I need a part",
    whatsappProfileName: "  Riya Sharma  ",
  }));
  assert.equal(prompt.customerContext.whatsappProfileName, "Riya Sharma");
  assert.equal(prompt.message, "I need a part");

  const noNamePrompt = JSON.parse(buildAssistantPrompt({ message: "Hello" }));
  assert.equal(noNamePrompt.customerContext.whatsappProfileName, "");
  assert.doesNotMatch(JSON.stringify(noNamePrompt.customerContext), /legal|verified/i);

  const boundedPrompt = JSON.parse(buildAssistantPrompt({
    message: "Hello",
    whatsappProfileName: "x".repeat(120),
  }));
  assert.equal(boundedPrompt.customerContext.whatsappProfileName.length, 100);
});