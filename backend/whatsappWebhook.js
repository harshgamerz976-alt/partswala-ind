import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createRateLimiter } from "./rateLimiter.js";
import { isMarketplaceAvailable } from "./marketplaceLaunch.js";

const WEBHOOK_PATH = "/api/webhooks/whatsapp";
const EVENT_COLLECTION = "whatsappWebhookEvents";
const CONVERSATION_COLLECTION = "whatsappConversations";
const ENQUIRY_COLLECTION = "whatsappEnquiries";
const OUTBOUND_COLLECTION = "whatsappOutboundMessages";
const MAX_HISTORY = 20;
const MAX_MESSAGE_LENGTH = 1000;
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const EVENT_LEASE_MS = 2 * 60 * 1000;

const inboundLimiter = createRateLimiter({ limit: 20, windowMs: 60_000, maxKeys: 20_000 });

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function timingSafeStringMatch(expected, supplied) {
  if (typeof expected !== "string" || !expected || typeof supplied !== "string") return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function verifyWhatsAppWebhookSignature(appSecret, signature, rawBody) {
  if (typeof appSecret !== "string" || !appSecret || !Buffer.isBuffer(rawBody)) return false;
  const match = /^sha256=([a-f\d]{64})$/i.exec(String(signature || ""));
  if (!match) return false;
  const supplied = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function eventDocumentId(event) {
  const stableParts = [event.eventType, event.messageId, event.status || "", event.timestamp || ""];
  return hash(`whatsapp:${JSON.stringify(stableParts)}`);
}

export function extractWhatsAppMessageText(message) {
  const candidate = message?.type === "text"
    ? message.text?.body
    : message?.type === "interactive"
      ? message.interactive?.button_reply?.title || message.interactive?.list_reply?.title
      : message?.type === "button"
        ? message.button?.text || message.button?.payload
        : "";
  if (typeof candidate !== "string") return "";
  return candidate.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, 2000);
}

function normalizedWhatsAppProfileName(value) {
  if (typeof value !== "string") return "";
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && !(codePoint <= 0x1f || codePoint === 0x7f);
    })
    .join("")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

export function extractWhatsAppWebhookEvents(payload) {
  if (!payload || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return [];
  const events = [];
  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      if (change?.field !== "messages" || !change.value || typeof change.value !== "object") continue;
      const value = change.value;
      const phoneNumberId = typeof value.metadata?.phone_number_id === "string"
        ? value.metadata.phone_number_id
        : "";
      const profileNames = new Map();
      for (const contact of Array.isArray(value.contacts) ? value.contacts : []) {
        if (typeof contact?.wa_id !== "string") continue;
        const name = normalizedWhatsAppProfileName(contact.profile?.name);
        if (name && !profileNames.has(contact.wa_id)) profileNames.set(contact.wa_id, name);
      }
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        if (typeof message?.id !== "string" || !message.id) continue;
        const senderId = typeof message.from === "string" ? message.from : "";
        events.push({
          eventType: "message",
          messageId: message.id,
          senderId,
          whatsappProfileName: profileNames.get(senderId) || "",
          messageType: typeof message.type === "string" ? message.type : "unknown",
          text: extractWhatsAppMessageText(message),
          timestamp: typeof message.timestamp === "string" ? message.timestamp : "",
          phoneNumberId,
        });
      }

      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        if (typeof status?.id !== "string" || !status.id || typeof status.status !== "string" || !status.status) continue;
        events.push({
          eventType: "message_status",
          messageId: status.id,
          recipientId: typeof status.recipient_id === "string" ? status.recipient_id : "",
          status: status.status,
          timestamp: typeof status.timestamp === "string" ? status.timestamp : "",
          phoneNumberId,
        });
      }
    }
  }
  return events;
}

function safeEventMetadata(event) {
  const { text: _text, whatsappProfileName: _whatsappProfileName, ...metadata } = event;
  return metadata;
}

async function claimEvent(database, event, now = Date.now()) {
  const reference = database.collection(EVENT_COLLECTION).doc(eventDocumentId(event));
  const claimed = await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) {
      const current = snapshot.data() || {};
      if (current.processingStatus === "processed"
        || (current.processingStatus === "processing" && Number(current.leaseUntil) > now)) {
        return false;
      }
      transaction.update(reference, {
        processingStatus: "processing",
        leaseUntil: now + EVENT_LEASE_MS,
        lastAttemptAt: new Date(now).toISOString(),
      });
      return true;
    }
    transaction.create(reference, {
      ...safeEventMetadata(event),
      provider: "whatsapp",
      processingStatus: "processing",
      leaseUntil: now + EVENT_LEASE_MS,
      receivedAt: new Date(now).toISOString(),
    });
    return true;
  });
  return { reference, claimed };
}

function validSenderId(value) {
  return typeof value === "string" && /^\d{6,20}$/.test(value);
}

function serviceWindowOpen(timestamp, now) {
  if (typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp)) return false;
  const messageTime = Number(timestamp) * 1000;
  return Number.isSafeInteger(messageTime)
    && messageTime <= now + 60_000
    && now - messageTime < SERVICE_WINDOW_MS;
}

function commandFor(text) {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
  if (["human", "agent", "talk to a human", "talk to an agent", "representative"].includes(normalized)) return "human";
  if (normalized === "help") return "help";
  if (normalized === "start") return "start";
  return "";
}

function normalizedSlot(value, maxLength) {
  if (typeof value !== "string") return "";
  const clean = value.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  return clean.length <= maxLength ? clean : "";
}

function isGenericVehicleType(value) {
  return /(?:^|\s)(?:truck|car|suv|bike|motorcycle|motorbike|scooter|van|bus|tractor|vehicle|other)$/i.test(value.trim());
}

function isYearLikeModel(value) {
  return /^(?:19[5-9]\d|20[0-3]\d)(?:\s+model)?$/i.test(value.trim());
}

function fallbackExtraction(text) {
  const year = /\b(19[5-9]\d|20[0-3]\d)\b/.exec(text)?.[1] || "";
  const quantityText = /\b(?:qty|quantity)\s*(?:is|of|:|=)?\s*(\d{1,7})\s*(sets?|pairs?|pieces?|pcs?|units?|kits?)?\b|\b(\d{1,7})\s*(sets?|pairs?|pieces?|pcs?|units?|kits?)\b/i.exec(text);
  const quantity = quantityText?.[1] || quantityText?.[3] || "";
  const quantityUnit = quantityText?.[2] || quantityText?.[4] || "";
  const explicitQuantity = quantity && quantity !== year ? Number(quantity) : 0;
  const partNumber = /\b(?:part\s*(?:number|no\.?|#)|p\/n|pn)\s*[:=-]?\s*([A-Z0-9-]{3,})\b/i.exec(text)?.[1] || "";
  const partPosition = /\b(front-left|front-right|rear-left|rear-right|front|rear|back|left|right|inner|outer)\b/i.exec(text)?.[1] || "";
  const partPattern = /\b(?:i\s+)?(?:need|want|require|looking\s+for|quote\s+for|find)\s+(?:a|an|some|the)?\s*(.+?)\s+(?:for|on|in|of)\s+(?:my\s+)?(?:\d{4}\s+)?([a-z][a-z0-9 -]{1,39})\b/i.exec(text);
  const modelPattern = /\b(?:for|on)\s+(?:my\s+)?(?:\d{4}\s+)?([a-z][a-z0-9-]*(?:\s+[a-z0-9-]+){0,3})\b/i.exec(text);
  const model = modelPattern?.[1]?.trim() || "";
  return {
    vehicle: { year, model: isGenericVehicleType(model) ? "" : model },
    partName: partPattern?.[1]?.trim() || "",
    partNumber,
    quantity: explicitQuantity,
    quantityUnit: quantityUnit.toLowerCase(),
    partPosition: partPosition.toLowerCase(),
  };
}

function supportedByMessage(value, text) {
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const compactText = normalizedText.replace(/\s+/g, "");
  const tokens = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((token) => token.length > 1);
  const compactValue = tokens.join("");
  return (tokens.length > 0 && tokens.every((token) => normalizedText.includes(token)))
    || (Boolean(compactValue) && compactText.includes(compactValue));
}

function makeResponseFromText(text, previous = {}, awaitingVehicleMake = false) {
  if (!awaitingVehicleMake || previous.vehicleMake || !/^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}$/.test(text.trim())) {
    return "";
  }
  const candidate = text.trim().replace(/\s+/g, " ");
  const normalized = candidate.toLowerCase();
  const nonMakeReplies = new Set([
    "hi", "hello", "hey", "yes", "yeah", "yep", "no", "nope", "ok", "okay",
    "i do not know", "i don't know", "not sure", "unknown", "front", "rear",
    "back", "left", "right", "inner", "outer",
  ]);
  if (nonMakeReplies.has(normalized)
    || candidate.toLowerCase() === String(previous.vehicleModel || "").toLowerCase()) {
    return "";
  }
  return candidate;
}

function extractSlots(intent, text, previous = {}, { awaitingVehicleMake = false } = {}) {
  if (!previous.vehicleMakeConfirmed && previous.vehicleMake
    && /^(yes|yeah|yep|correct|that's right|that is right)$/i.test(text.trim())) {
    return {
      vehicleMake: previous.vehicleMake,
      vehicleMakeConfirmed: true,
    };
  }
  const args = intent?.args || {};
  const vehicle = args.vehicle || {};
  const fallback = fallbackExtraction(text);
  const manufacturer = normalizedSlot(vehicle.manufacturer, 48);
  const model = normalizedSlot(vehicle.model, 80);
  const partName = normalizedSlot(args.partName, 120);
  const partNumber = normalizedSlot(args.partNumber, 80);
  const year = normalizedSlot(vehicle.year, 4);
  const makeIsExplicit = supportedByMessage(manufacturer, text);
  const vehicleMake = makeIsExplicit
    ? manufacturer
    : makeResponseFromText(text, previous, awaitingVehicleMake);
  return {
    vehicleMake,
    vehicleMakeConfirmed: Boolean(vehicleMake),
    vehicleModel: !isGenericVehicleType(model) && !isYearLikeModel(model) && supportedByMessage(model, text)
      ? model
      : fallback.vehicle.model,
    vehicleYear: /^\d{4}$/.test(year) && text.includes(year) ? year : fallback.vehicle.year,
    partName: supportedByMessage(partName, text) ? partName : fallback.partName,
    partNumber: supportedByMessage(partNumber, text) ? partNumber : fallback.partNumber,
    quantity: fallback.quantity,
    quantityUnit: normalizedSlot(args.quantityUnit, 24) && fallback.quantity
      ? normalizedSlot(args.quantityUnit, 24)
      : fallback.quantityUnit,
    partPosition: supportedByMessage(normalizedSlot(args.partPosition, 48), text)
      ? normalizedSlot(args.partPosition, 48)
      : fallback.partPosition,
  };
}

function mergeSlots(previous = {}, extracted = {}) {
  return {
    vehicleMake: extracted.vehicleMake || previous.vehicleMake || "",
    vehicleMakeConfirmed: extracted.vehicleMake
      ? extracted.vehicleMakeConfirmed === true
      : previous.vehicleMakeConfirmed === true,
    vehicleModel: extracted.vehicleModel || previous.vehicleModel || "",
    vehicleYear: extracted.vehicleYear || previous.vehicleYear || "",
    partName: extracted.partName || previous.partName || "",
    partNumber: extracted.partNumber || previous.partNumber || "",
    quantity: extracted.quantity || previous.quantity || 0,
    quantityUnit: extracted.quantity ? extracted.quantityUnit || previous.quantityUnit || "" : previous.quantityUnit || "",
    partPosition: extracted.partPosition || previous.partPosition || "",
  };
}

function slotsComplete(slots) {
  return Boolean(slots.vehicleMake && slots.vehicleMakeConfirmed && slots.vehicleModel
    && /^\d{4}$/.test(slots.vehicleYear)
    && (slots.partName || slots.partNumber)
    && Number.isSafeInteger(slots.quantity) && slots.quantity > 0);
}

function missingDetailsReply(slots) {
  const missing = [];
  if (slots.vehicleMake && !slots.vehicleMakeConfirmed) {
    missing.push(`confirmation that ${slots.vehicleMake} is the correct make${slots.vehicleModel ? ` for the ${slots.vehicleModel}` : ""}`);
  } else if (!slots.vehicleMake) {
    missing.push("vehicle make");
  }
  if (!slots.vehicleModel) missing.push("vehicle model");
  if (!slots.vehicleYear) missing.push("vehicle year");
  if (!slots.partName && !slots.partNumber) missing.push("part name or part number");
  if (!slots.quantity) missing.push("quantity");
  if (!missing.length) {
    return "I have the details needed for a quote. Our team will confirm availability and pricing; nothing is ordered or paid for.";
  }
  return `To request a quote, please share your ${missing.join(" and ")}.`;
}

function welcomePrefix(isNew) {
  return isNew
    ? "Hi, welcome to PARTSWALA! I can help collect details for a parts quote. "
    : "";
}

function textReplyFor({ command, slots, isNew, enquiryCreated, takeoverWasActive, marketplaceOpen }) {
  if (command === "human") {
    return `${welcomePrefix(isNew)}I've notified our team that you'd like a person to help. Automated replies are paused. Send START whenever you'd like to resume them.`;
  }
  if (command === "help") {
    return `${welcomePrefix(isNew)}Send your vehicle make and model, year, part name or part number, and quantity to request a quote. Send HUMAN or AGENT for a person; send START to resume automated replies.`;
  }
  if (command === "start" && takeoverWasActive) {
    return `Automated help is back on. ${slotsComplete(slots)
      ? "Your request is already with our team for a quote."
      : missingDetailsReply(slots)}`;
  }
  if (command === "start") {
    return `${welcomePrefix(isNew)}Automated help is on. ${slotsComplete(slots)
      ? "Your request is already with our team for a quote."
      : missingDetailsReply(slots)}`;
  }
  if (!marketplaceOpen) {
    return `${welcomePrefix(isNew)}The marketplace is not accepting quote requests yet. Please check back after launch.`;
  }
  if (enquiryCreated) {
    return "Thanks — I've sent your request to our team. They'll confirm availability and pricing with a quote. Nothing has been ordered or paid for.";
  }
  if (slotsComplete(slots)) {
    return "Thanks, I have those details. Our team will follow up with a quote to confirm availability and pricing. Nothing has been ordered or paid for.";
  }
  if (!slots.vehicleMake && !slots.vehicleModel && !slots.vehicleYear
    && !slots.partName && !slots.partNumber && !slots.quantity) {
    return `${welcomePrefix(isNew)}What vehicle and part do you need help with?`;
  }
  return `${welcomePrefix(isNew)}${missingDetailsReply(slots)} Our team will confirm availability and pricing; nothing is ordered or paid for.`;
}

function isConversationId(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

async function prepareConversationTurn({ database, event, intent, answer, marketplaceOpen, now }) {
  const conversationId = hash(`whatsapp:${event.phoneNumberId}:${event.senderId}`);
  const conversationRef = database.collection(CONVERSATION_COLLECTION).doc(conversationId);
  const enquiryId = randomUUID();
  const enquiryRef = database.collection(ENQUIRY_COLLECTION).doc(enquiryId);
  const outboxRef = database.collection(OUTBOUND_COLLECTION).doc(hash(`whatsapp:${event.messageId}`));
  return database.runTransaction(async (transaction) => {
    const conversationSnapshot = await transaction.get(conversationRef);
    const current = conversationSnapshot.exists ? conversationSnapshot.data() || {} : {};
    const history = Array.isArray(current.messages) ? current.messages : [];
    const existingReply = history.find((message) => message.role === "assistant" && message.replyTo === event.messageId);
    if (existingReply) {
      return {
        conversationId,
        reply: existingReply.text,
        enquiryId: current.enquiryId || "",
        notifyType: current.lastEnquiryMessageId === event.messageId
          ? "enquiry"
          : current.lastHumanRequestMessageId === event.messageId
            ? "human-request"
            : "",
        outboxRef,
        isReplay: true,
      };
    }

    const isNew = !current.firstSeenAt;
    const command = commandFor(event.text);
    const takeoverWasActive = current.mode === "human";
    const lastAssistantMessage = [...history].reverse().find((message) => message.role === "assistant");
    const awaitingVehicleMake = Boolean(lastAssistantMessage
      && /vehicle make/i.test(lastAssistantMessage.text || ""));
    const extractedSlots = command
      ? {}
      : extractSlots(intent, event.text, current.slots, { awaitingVehicleMake });
    const slots = mergeSlots(current.slots, extractedSlots);
    const messages = [...history, {
      role: "user",
      text: event.text,
      messageId: event.messageId,
      at: new Date(now).toISOString(),
    }];
    let mode = current.mode === "human" ? "human" : "bot";
    let enquiryCreated = false;
    let savedEnquiryId = current.enquiryId || "";
    let notifyType = "";
    let reply = "";

    if (command === "human") {
      mode = "human";
      notifyType = "human-request";
      reply = textReplyFor({ command, slots, isNew, takeoverWasActive, marketplaceOpen });
    } else if (command === "start") {
      mode = "bot";
      reply = textReplyFor({ command, slots, isNew, takeoverWasActive, marketplaceOpen });
    } else if (mode === "human") {
      reply = "";
    } else if (command === "help") {
      reply = textReplyFor({ command, slots, isNew, takeoverWasActive, marketplaceOpen });
    } else if (!marketplaceOpen) {
      reply = textReplyFor({ slots, isNew, takeoverWasActive, marketplaceOpen });
    } else if (answer && !slotsComplete(slots)) {
      reply = `${welcomePrefix(isNew)}${answer}`;
    } else if (slotsComplete(slots) && !savedEnquiryId) {
      savedEnquiryId = enquiryId;
      enquiryCreated = true;
      notifyType = "enquiry";
      reply = textReplyFor({ slots, isNew, enquiryCreated, takeoverWasActive, marketplaceOpen });
      transaction.create(enquiryRef, {
        id: enquiryId,
        conversationId,
        senderPhone: event.senderId,
        vehicleMake: slots.vehicleMake,
        vehicleModel: slots.vehicleModel,
        vehicleYear: slots.vehicleYear,
        partName: slots.partName || "",
        partNumber: slots.partNumber || "",
        partPosition: slots.partPosition || "",
        quantity: slots.quantity,
        quantityUnit: slots.quantityUnit || "",
        status: "new",
        conversationStatus: "quote_requested",
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      });
    } else if (savedEnquiryId) {
      reply = textReplyFor({ slots, isNew, enquiryCreated: true, takeoverWasActive, marketplaceOpen });
    } else {
      reply = textReplyFor({ slots, isNew, takeoverWasActive, marketplaceOpen });
    }

    if (reply) {
      messages.push({
        role: "assistant",
        text: reply,
        replyTo: event.messageId,
        at: new Date(now).toISOString(),
      });
      transaction.set(outboxRef, {
        recipient: event.senderId,
        phoneNumberId: event.phoneNumberId,
        text: reply,
        status: "prepared",
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      });
    }
    const lastHumanRequestMessageId = command === "human"
      ? event.messageId
      : current.lastHumanRequestMessageId || "";
    const lastEnquiryMessageId = enquiryCreated ? event.messageId : current.lastEnquiryMessageId || "";
    transaction.set(conversationRef, {
      phoneNumberId: event.phoneNumberId,
      senderId: event.senderId,
      firstSeenAt: current.firstSeenAt || new Date(now).toISOString(),
      lastIncomingAt: new Date(now).toISOString(),
      lastMessageId: event.messageId,
      mode,
      status: mode === "human" ? "human_takeover" : savedEnquiryId ? "quote_requested" : "collecting_details",
      slots,
      whatsappProfileName: normalizedWhatsAppProfileName(event.whatsappProfileName)
        || normalizedWhatsAppProfileName(current.whatsappProfileName),
      enquiryId: savedEnquiryId,
      lastHumanRequestMessageId,
      lastEnquiryMessageId,
      messages: messages.slice(-MAX_HISTORY),
      updatedAt: new Date(now).toISOString(),
    });
    return {
      conversationId,
      reply,
      enquiryId: savedEnquiryId,
      notifyType,
      outboxRef,
      enquiryCreated,
      isReplay: false,
    };
  });
}

async function markOutbox(database, reference, updates) {
  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) transaction.update(reference, { ...updates, updatedAt: new Date().toISOString() });
  });
}

function boundedRetryDelay(retryAfter, now = Date.now()) {
  if (!retryAfter) return 250;
  const seconds = Number(retryAfter);
  const delay = Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Date.parse(retryAfter) - now;
  return Number.isFinite(delay) && delay >= 0 && delay <= 1000 ? delay : null;
}

async function sendWhatsAppText({ env, fetchImpl, to, phoneNumberId, text }) {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const configuredPhoneId = env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = env.WHATSAPP_GRAPH_API_VERSION || "v22.0";
  if (typeof token !== "string" || !token || typeof configuredPhoneId !== "string"
    || !/^\d+$/.test(configuredPhoneId) || !/^v\d+\.\d+$/.test(apiVersion)) {
    throw new WhatsAppDeliveryError("WhatsApp Cloud API is not configured.", { retryable: true, reason: "configuration" });
  }
  if (phoneNumberId !== configuredPhoneId) {
    throw new WhatsAppDeliveryError("WhatsApp business number does not match configuration.", { retryable: false, reason: "number_mismatch" });
  }
  const requestUrl = `https://graph.facebook.com/${apiVersion}/${configuredPhoneId}/messages`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(requestUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: text, preview_url: false },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new WhatsAppDeliveryError("WhatsApp Cloud API request outcome is unknown.", { uncertain: true, reason: "unknown_outcome" });
    }
    if (response.ok) {
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      return typeof payload?.messages?.[0]?.id === "string" ? payload.messages[0].id : "";
    }
    if (response.status === 429 && attempt === 0) {
      const waitMs = boundedRetryDelay(response.headers.get("retry-after"));
      if (waitMs !== null) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
    }
    if (response.status >= 500) {
      throw new WhatsAppDeliveryError("WhatsApp Cloud API request outcome is unknown.", {
        uncertain: true,
        reason: `http_${response.status}`,
      });
    }
    const retryable = response.status === 429;
    throw new WhatsAppDeliveryError("WhatsApp Cloud API rejected the message.", {
      retryable,
      reason: `http_${response.status}`,
    });
  }
  throw new WhatsAppDeliveryError("WhatsApp Cloud API did not accept the message.", { retryable: true, reason: "retry_exhausted" });
}

export class WhatsAppDeliveryError extends Error {
  constructor(message, { retryable = false, uncertain = false, reason = "unknown" } = {}) {
    super(message);
    this.name = "WhatsAppDeliveryError";
    this.retryable = retryable;
    this.uncertain = uncertain;
    this.reason = reason;
  }
}

async function deliverOutbox({ database, outboxRef, sendText }) {
  const claim = await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(outboxRef);
    if (!snapshot.exists) return null;
    const current = snapshot.data() || {};
    const now = Date.now();
    if (["sent", "uncertain"].includes(current.status)
      || (current.status === "sending" && Number(current.leaseUntil) > now)) return null;
    transaction.update(outboxRef, {
      status: "sending",
      leaseUntil: now + EVENT_LEASE_MS,
      updatedAt: new Date().toISOString(),
    });
    return current;
  });
  if (!claim) return;
  try {
    const providerMessageId = await sendText({
      to: claim.recipient,
      phoneNumberId: claim.phoneNumberId || "",
      text: claim.text,
    });
    await markOutbox(database, outboxRef, { status: "sent", providerMessageId: providerMessageId || "" });
  } catch (error) {
    if (error?.uncertain) {
      await markOutbox(database, outboxRef, { status: "uncertain" });
      console.warn("WhatsApp reply delivery outcome is unknown; automatic resend suppressed.");
      return;
    }
    await markOutbox(database, outboxRef, { status: "failed" });
    throw error;
  }
}

async function processIncomingMessage({
  database,
  event,
  interpretMessage,
  answerQuestion,
  notifyTeam,
  sendText,
  isMarketplaceOpen,
  now,
  rateLimiter = inboundLimiter,
}) {
  if (!validSenderId(event.senderId) || !event.phoneNumberId) return;
  if (!serviceWindowOpen(event.timestamp, now)) {
    console.info("WhatsApp message outside the customer-service window was ignored.");
    return;
  }
  const rateKey = hash(`whatsapp-rate:${event.senderId}`);
  if (!rateLimiter.check(rateKey, now).allowed) {
    console.warn("WhatsApp sender rate limit reached.");
    return;
  }
  const conversationId = hash(`whatsapp:${event.phoneNumberId}:${event.senderId}`);
  const conversationSnapshot = await database.collection(CONVERSATION_COLLECTION).doc(conversationId).get();
  const conversation = conversationSnapshot.exists ? conversationSnapshot.data() || {} : {};
  const whatsappProfileName = normalizedWhatsAppProfileName(event.whatsappProfileName)
    || normalizedWhatsAppProfileName(conversation.whatsappProfileName);
  const command = commandFor(event.text);
  let intent = null;
  const marketplaceOpen = isMarketplaceOpen();
  if (event.text && !command && conversation.mode !== "human" && marketplaceOpen && interpretMessage) {
    try {
      intent = await interpretMessage({
        message: event.text.slice(0, MAX_MESSAGE_LENGTH),
        history: Array.isArray(conversation.messages) ? conversation.messages.slice(-8) : [],
        whatsappProfileName,
      });
    } catch {
      console.error("WhatsApp AI detail extraction failed; using message-only extraction.");
    }
  }
  let answer = "";
  if (intent?.action === "getStoreInfo" && answerQuestion) {
    try {
      answer = normalizedSlot(await answerQuestion(intent), 800);
    } catch {
      console.error("WhatsApp store-information lookup failed.");
    }
  }
  const turn = await prepareConversationTurn({ database, event, intent, answer, marketplaceOpen, now });
  if (turn.notifyType && notifyTeam) {
    await notifyTeam({
      type: turn.notifyType,
      conversationId: turn.conversationId,
      enquiryId: turn.enquiryId,
      eventId: event.messageId,
    });
  }
  if (turn.reply) {
    await deliverOutbox({ database, outboxRef: turn.outboxRef, sendText });
  }
}

function createMemorySnapshot(collection, id, value) {
  return {
    collection,
    id,
    exists: value !== undefined,
    data: () => value === undefined ? undefined : structuredClone(value),
  };
}

function createMemoryDatabase() {
  const collections = new Map();
  const documents = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };
  const reference = (collection, id) => ({
    collection,
    id,
    async get() {
      return createMemorySnapshot(collection, id, documents(collection).get(id));
    },
  });
  return {
    collections,
    collection(name) {
      return {
        doc(id) {
          return reference(name, id);
        },
        orderBy() {
          return this;
        },
        limit() {
          return this;
        },
        async get() {
          const docs = [...documents(name)].map(([id, value]) => createMemorySnapshot(name, id, value));
          return { docs };
        },
      };
    },
    async runTransaction(work) {
      return work({
        async get(ref) {
          return createMemorySnapshot(ref.collection, ref.id, documents(ref.collection).get(ref.id));
        },
        create(ref, value) {
          const collection = documents(ref.collection);
          if (collection.has(ref.id)) throw new Error("Document already exists.");
          collection.set(ref.id, structuredClone(value));
        },
        set(ref, value) {
          documents(ref.collection).set(ref.id, structuredClone(value));
        },
        update(ref, updates) {
          const collection = documents(ref.collection);
          if (!collection.has(ref.id)) throw new Error("Document does not exist.");
          collection.set(ref.id, { ...collection.get(ref.id), ...structuredClone(updates) });
        },
      });
    },
  };
}

function simulatorConversation(session, database) {
  const conversationId = hash(`whatsapp:${session.phoneNumberId}:${session.senderId}`);
  const snapshot = database.collections.get(CONVERSATION_COLLECTION)?.get(conversationId);
  const enquiries = [...(database.collections.get(ENQUIRY_COLLECTION)?.values() || [])]
    .filter((enquiry) => enquiry.conversationId === conversationId);
  return {
    id: session.id,
    label: session.label,
    status: snapshot?.status || "collecting_details",
    mode: snapshot?.mode || "bot",
    whatsappProfileName: snapshot?.whatsappProfileName || "",
    slots: snapshot?.slots || {
      vehicleMake: "",
      vehicleModel: "",
      vehicleYear: "",
      partName: "",
      partNumber: "",
      partPosition: "",
      quantity: 0,
      quantityUnit: "",
    },
    messages: snapshot?.messages || [],
    enquiries: enquiries.map((enquiry) => ({ ...enquiry })),
    updatedAt: snapshot?.updatedAt || session.createdAt,
  };
}

export function createWhatsAppSimulator({
  interpretMessage,
  answerQuestion,
  isMarketplaceOpen = () => isMarketplaceAvailable(),
  now = Date.now,
} = {}) {
  const database = createMemoryDatabase();
  const sessions = new Map();
  const simulatorLimiter = createRateLimiter({ limit: 1000, windowMs: 60_000, maxKeys: 1000 });
  let nextCustomer = 1;
  const phoneNumberId = "999000000000";

  function getSession(conversationId) {
    const session = sessions.get(conversationId);
    if (!session) throw new Error("Simulator conversation not found.");
    return session;
  }

  return {
    listConversations() {
      return [...sessions.values()]
        .map((session) => simulatorConversation(session, database))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    createConversation() {
      const id = randomUUID();
      const session = {
        id,
        label: `Customer ${nextCustomer}`,
        senderId: String(9000000000 + nextCustomer),
        phoneNumberId,
        createdAt: new Date(now()).toISOString(),
      };
      nextCustomer += 1;
      sessions.set(id, session);
      return simulatorConversation(session, database);
    },
    getConversation(conversationId) {
      return simulatorConversation(getSession(conversationId), database);
    },
    async sendMessage(conversationId, value) {
      const session = getSession(conversationId);
      const text = typeof value === "string" ? value.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
      if (!text) throw new Error("Enter a customer message.");
      const timestamp = Math.floor(now() / 1000);
      await processIncomingMessage({
        database,
        event: {
          eventType: "message",
          messageId: `simulated:${randomUUID()}`,
          senderId: session.senderId,
          messageType: "text",
          text,
          timestamp: String(timestamp),
          phoneNumberId: session.phoneNumberId,
        },
        interpretMessage,
        answerQuestion,
        notifyTeam: async () => {},
        sendText: async () => "",
        isMarketplaceOpen,
        now: now(),
        rateLimiter: simulatorLimiter,
      });
      session.updatedAt = new Date(now()).toISOString();
      return simulatorConversation(session, database);
    },
    setMode(conversationId, mode) {
      if (!["human", "bot"].includes(mode)) throw new Error("Choose human or bot mode.");
      const session = getSession(conversationId);
      const conversationIdHash = hash(`whatsapp:${session.phoneNumberId}:${session.senderId}`);
      const conversations = database.collections.get(CONVERSATION_COLLECTION)
        || new Map();
      database.collections.set(CONVERSATION_COLLECTION, conversations);
      const conversation = conversations.get(conversationIdHash) || {
        phoneNumberId: session.phoneNumberId,
        senderId: session.senderId,
        whatsappProfileName: "",
        firstSeenAt: session.createdAt,
        lastIncomingAt: "",
        lastMessageId: "",
        slots: {
          vehicleMake: "",
          vehicleModel: "",
          vehicleYear: "",
          partName: "",
          partNumber: "",
          partPosition: "",
          quantity: 0,
          quantityUnit: "",
        },
        enquiryId: "",
        messages: [],
      };
      conversation.mode = mode;
      conversation.status = mode === "human"
        ? "human_takeover"
        : conversation.enquiryId ? "quote_requested" : "collecting_details";
      conversation.updatedAt = new Date(now()).toISOString();
      conversations.set(conversationIdHash, conversation);
      session.updatedAt = new Date(now()).toISOString();
      return simulatorConversation(session, database);
    },
  };
}

function publicEnquiry(document) {
  const value = document.data() || {};
  return {
    id: document.id,
    conversationId: value.conversationId || "",
    senderPhone: value.senderPhone || "",
    vehicleMake: value.vehicleMake || "",
    vehicleModel: value.vehicleModel || "",
    vehicleYear: value.vehicleYear || "",
    partName: value.partName || "",
    partNumber: value.partNumber || "",
    partPosition: value.partPosition || "",
    quantity: value.quantity || 0,
    quantityUnit: value.quantityUnit || "",
    status: value.status || "new",
    conversationStatus: value.conversationStatus || "",
    createdAt: value.createdAt || "",
    updatedAt: value.updatedAt || "",
  };
}

async function requireAuthorizedAdmin(request, response, authorizeAdmin) {
  if (!authorizeAdmin) {
    response.status(503).json({ message: "WhatsApp team access is not configured." });
    return null;
  }
  try {
    const user = await authorizeAdmin(request);
    if (!user) {
      response.status(403).json({ message: "Authorized administrator access is required." });
      return null;
    }
    return user;
  } catch {
    response.status(401).json({ message: "Authentication is required." });
    return null;
  }
}

export function registerWhatsAppWebhookRoutes(app, {
  getDb,
  env = process.env,
  fetchImpl = globalThis.fetch,
  interpretMessage,
  answerQuestion,
  notifyTeam,
  authorizeAdmin,
  isMarketplaceOpen = () => isMarketplaceAvailable(),
  now = Date.now,
}) {
  app.get(WEBHOOK_PATH, (request, response) => {
    const mode = request.query["hub.mode"];
    const verifyToken = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];
    if (mode !== "subscribe"
      || typeof challenge !== "string"
      || !timingSafeStringMatch(env.WHATSAPP_VERIFY_TOKEN, verifyToken)) {
      return response.sendStatus(403);
    }

    return response.type("text/plain").status(200).send(challenge);
  });

  app.post(WEBHOOK_PATH, async (request, response) => {
    if (typeof env.META_APP_SECRET !== "string" || !env.META_APP_SECRET) {
      return response.status(503).json({ message: "WhatsApp webhook verification is not configured." });
    }
    if (!verifyWhatsAppWebhookSignature(env.META_APP_SECRET, request.get("x-hub-signature-256"), request.rawBody)) {
      return response.status(401).json({ message: "Invalid webhook signature." });
    }
    const events = extractWhatsAppWebhookEvents(request.body);
    if (!events.length) return response.status(200).json({ ok: true, ignored: true });

    try {
      const database = getDb();
      let processed = 0;
      let duplicates = 0;
      for (const event of events) {
        if (env.WHATSAPP_PHONE_NUMBER_ID
          && event.phoneNumberId !== env.WHATSAPP_PHONE_NUMBER_ID) {
          duplicates += 1;
          continue;
        }
        const { reference, claimed } = await claimEvent(database, event, now());
        if (!claimed) {
          duplicates += 1;
          continue;
        }
        try {
          if (event.eventType === "message") {
            await processIncomingMessage({
              database,
              event,
              interpretMessage,
              answerQuestion,
              notifyTeam,
              sendText: (message) => sendWhatsAppText({
                env,
                fetchImpl,
                ...message,
              }),
              isMarketplaceOpen,
              now: now(),
            });
          }
          await database.runTransaction(async (transaction) => {
            transaction.update(reference, {
              processingStatus: "processed",
              processedAt: new Date(now()).toISOString(),
              leaseUntil: 0,
            });
          });
          processed += 1;
        } catch (error) {
          await database.runTransaction(async (transaction) => {
            transaction.update(reference, {
              processingStatus: "failed",
              leaseUntil: 0,
              failedAt: new Date(now()).toISOString(),
            });
          });
          if (error instanceof WhatsAppDeliveryError) {
            console.error("WhatsApp reply delivery failed:", error.reason);
          } else {
            console.error("WhatsApp message processing failed.");
          }
          return response.status(500).json({ message: "WhatsApp message could not be processed." });
        }
      }
      return response.status(200).json({ ok: true, processed, duplicates });
    } catch {
      console.error("WhatsApp webhook event persistence failed.");
      return response.status(500).json({ message: "WhatsApp webhook events could not be processed." });
    }
  });

  app.get("/api/admin/whatsapp/enquiries", async (request, response) => {
    if (!await requireAuthorizedAdmin(request, response, authorizeAdmin)) return;
    try {
      const snapshot = await getDb().collection(ENQUIRY_COLLECTION).orderBy("createdAt", "desc").limit(50).get();
      return response.json({ enquiries: snapshot.docs.map(publicEnquiry) });
    } catch {
      console.error("WhatsApp enquiry list could not be loaded.");
      return response.status(503).json({ message: "WhatsApp enquiries could not be loaded." });
    }
  });

  app.get("/api/admin/whatsapp/conversations/:conversationId", async (request, response) => {
    if (!await requireAuthorizedAdmin(request, response, authorizeAdmin)) return;
    const { conversationId } = request.params;
    if (!isConversationId(conversationId)) return response.status(400).json({ message: "A valid conversation ID is required." });
    try {
      const snapshot = await getDb().collection(CONVERSATION_COLLECTION).doc(conversationId).get();
      if (!snapshot.exists) return response.status(404).json({ message: "Conversation not found." });
      return response.json({ id: conversationId, ...snapshot.data() });
    } catch {
      console.error("WhatsApp conversation could not be loaded.");
      return response.status(503).json({ message: "WhatsApp conversation could not be loaded." });
    }
  });

  app.patch("/api/admin/whatsapp/conversations/:conversationId", async (request, response) => {
    if (!await requireAuthorizedAdmin(request, response, authorizeAdmin)) return;
    const { conversationId } = request.params;
    if (!isConversationId(conversationId) || !["bot", "human"].includes(request.body?.mode)) {
      return response.status(400).json({ message: "Provide a valid conversation ID and mode." });
    }
    try {
      const reference = getDb().collection(CONVERSATION_COLLECTION).doc(conversationId);
      const snapshot = await reference.get();
      if (!snapshot.exists) return response.status(404).json({ message: "Conversation not found." });
      await reference.update({
        mode: request.body.mode,
        status: request.body.mode === "human" ? "human_takeover" : snapshot.data()?.enquiryId ? "quote_requested" : "collecting_details",
        updatedAt: new Date(now()).toISOString(),
      });
      return response.json({ ok: true, mode: request.body.mode });
    } catch {
      console.error("WhatsApp conversation takeover could not be updated.");
      return response.status(503).json({ message: "WhatsApp conversation could not be updated." });
    }
  });
}

export function registerWhatsAppSimulatorRoutes(app, { simulator, env = process.env }) {
  const localOnly = (request, response, next) => {
    const remoteAddress = request.socket?.remoteAddress || "";
    const localAddress = remoteAddress === "::1"
      || remoteAddress === "127.0.0.1"
      || remoteAddress.startsWith("::ffff:127.");
    if (env.NODE_ENV !== "development" || env.WHATSAPP_SIMULATOR_ENABLED !== "true" || !localAddress) {
      return response.sendStatus(404);
    }
    return next();
  };

  app.get("/api/dev/whatsapp-simulator/conversations", localOnly, (_request, response) => {
    return response.json({ conversations: simulator.listConversations() });
  });

  app.post("/api/dev/whatsapp-simulator/conversations", localOnly, (_request, response) => {
    return response.status(201).json({ conversation: simulator.createConversation() });
  });

  app.get("/api/dev/whatsapp-simulator/conversations/:conversationId", localOnly, (request, response) => {
    try {
      return response.json({ conversation: simulator.getConversation(request.params.conversationId) });
    } catch {
      return response.status(404).json({ message: "Simulator conversation not found." });
    }
  });

  app.post("/api/dev/whatsapp-simulator/conversations/:conversationId/messages", localOnly, async (request, response) => {
    try {
      const conversation = await simulator.sendMessage(request.params.conversationId, request.body?.text);
      return response.json({ conversation });
    } catch (error) {
      return response.status(400).json({ message: error.message || "Simulator message could not be processed." });
    }
  });

  app.patch("/api/dev/whatsapp-simulator/conversations/:conversationId", localOnly, (request, response) => {
    try {
      const conversation = simulator.setMode(request.params.conversationId, request.body?.mode);
      return response.json({ conversation });
    } catch (error) {
      return response.status(400).json({ message: error.message || "Simulator conversation could not be updated." });
    }
  });
}
