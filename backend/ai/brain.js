import { allowedAssistantTools } from "./authorization.js";

function boundedText(value, length = 240) {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

function normalizeIntent(value, availableTools) {
  const action = boundedText(value?.action, 40);
  const args = value?.args && typeof value.args === "object" ? value.args : {};
  const vehicle = args.vehicle && typeof args.vehicle === "object" ? args.vehicle : {};
  const productIds = Array.isArray(args.productIds) ? args.productIds.filter((id) => typeof id === "string").slice(0, 5) : [];
  const number = Number(args.maxPrice);
  return {
    action: action === "clarify" ? action : availableTools.includes(action) ? action : "answer",
    reply: boundedText(value?.reply, 600),
    args: {
      query: boundedText(args.query || value?.query, 240),
      productId: boundedText(args.productId, 160),
      productIds,
      orderId: boundedText(args.orderId, 160),
      maxPrice: Number.isFinite(number) && number > 0 ? number : null,
      quantity: Math.min(50, Math.max(1, Math.trunc(Number(args.quantity) || 1))),
      deliveryPincode: /^\d{6}$/.test(String(args.deliveryPincode || "")) ? String(args.deliveryPincode) : "",
      paymentMethod: ["COD", "Prepaid", "Online"].includes(args.paymentMethod) ? args.paymentMethod : "COD",
      vehicle: Object.fromEntries(["manufacturer", "model", "variant", "year", "engine"].map((key) => [key, boundedText(vehicle[key], 48)]).filter(([, item]) => item)),
    },
  };
}

function parseJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(raw);
}

export async function interpretAssistantMessage({ apiKey, model, groqApiKey, groqModel, message, history = [], context = {}, role = "customer" }) {
  if (!apiKey) throw new Error("Gemini is not configured.");
  const availableTools = allowedAssistantTools(role);
  const prompt = JSON.stringify({
    message: boundedText(message, 1000),
    recentConversation: history.slice(-8).map((entry) => ({ role: entry.role, text: boundedText(entry.text, 500) })),
    availableContext: {
      recentProductIds: Array.isArray(context.recentProductIds) ? context.recentProductIds.filter((id) => typeof id === "string").slice(0, 5) : [],
      recentProducts: Array.isArray(context.recentProducts) ? context.recentProducts.slice(0, 5).map((item) => ({ id: boundedText(item.id, 160), name: boundedText(item.name, 100), partNumber: boundedText(item.partNumber, 80) })) : [],
      cart: Array.isArray(context.cart) ? context.cart.slice(0, 30).map((item) => ({ id: boundedText(item.id, 160), name: boundedText(item.name || item.title, 100), partNumber: boundedText(item.partNumber, 80), quantity: Math.max(1, Math.trunc(Number(item.quantity) || 1)) })) : [],
    },
  });
  const systemInstruction = `You are the intent interpreter for PARTSWALA AI, a concise commercial truck-parts specialist. Convert the user's request into exactly one JSON object: {"action":"...","reply":"...","args":{...}}. Available server actions for this ${role} account: ${availableTools.join(", ")}. Choose only an available action. Use "clarify" and put one short, specific question in reply when a vehicle or part detail is needed to avoid ambiguity. For product requests use searchProducts and provide a short catalogue query, vehicle fields, and maxPrice when stated. For compatibility use checkCompatibility and include only vehicle information stated in conversation. For policies, payment methods, returns, support, or business information choose getStoreInfo; for the status/payment/refund of an order choose getOrders. Distinguish a shipping-policy question from a price estimate for selected products. For cart/order/shipping/vendor/admin requests choose the matching action. Never fabricate product IDs: use only IDs supplied in recentProducts or cart context. For general questions choose answer. Do not calculate or state prices, tax, commissions, shipping, payouts, payment status, or fitment; those come from server data. Return valid JSON only.`;

  const generateGemini = async () => {
    if (!apiKey) throw new Error("Gemini is not configured.");
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: model || "gemini-3.8-flash",
      contents: prompt,
      config: { responseMimeType: "application/json", systemInstruction },
    });
    return result.text;
  };
  const generateGroq = async () => {
    const { default: Groq } = await import("groq-sdk");
    const groq = new Groq({ apiKey: groqApiKey });
    const result = await groq.chat.completions.create({
      model: groqModel || "openai/gpt-oss-120b",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
      ],
    });
    return result.choices?.[0]?.message?.content;
  };

  const responseText = await withGeminiGroqFallback({
    generateGemini,
    generateGroq,
    groqAvailable: Boolean(groqApiKey),
  });
  return normalizeIntent(parseJson(responseText), availableTools);
}

export function isTemporaryGeminiCapacityError(error) {
  return /\b(429|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(String(error?.message || error));
}

export async function withGeminiGroqFallback({ generateGemini, generateGroq, groqAvailable }) {
  try {
    return await generateGemini();
  } catch (error) {
    if (!groqAvailable || !isTemporaryGeminiCapacityError(error)) throw error;
    return generateGroq();
  }
}