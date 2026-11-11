import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import {
  createWhatsAppSimulator,
  extractWhatsAppWebhookEvents,
  registerWhatsAppSimulatorRoutes,
  registerWhatsAppWebhookRoutes,
} from "./whatsappWebhook.js";

const VERIFY_TOKEN = "test-whatsapp-verify-token";
const APP_SECRET = "test-meta-app-secret";
const PHONE_NUMBER_ID = "123456789012345";
const ACCESS_TOKEN = "test-access-token";

function createDatabase() {
  const collections = new Map();
  function getCollection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }
  function makeReference(collection, id) {
    return {
      collection,
      id,
      async get() {
        const value = getCollection(collection).get(id);
        return { exists: value !== undefined, id, data: () => value && structuredClone(value) };
      },
      async update(updates) {
        const documents = getCollection(collection);
        if (!documents.has(id)) throw new Error("Missing document.");
        documents.set(id, { ...documents.get(id), ...structuredClone(updates) });
      },
    };
  }
  return {
    collections,
    collection(name) {
      return {
        doc(id) {
          return makeReference(name, id);
        },
        orderBy() {
          return this;
        },
        limit() {
          return this;
        },
        async get() {
          const documents = [...getCollection(name)].map(([id, value]) => ({
            id,
            data: () => structuredClone(value),
          }));
          return { docs: documents };
        },
      };
    },
    async runTransaction(work) {
      return work({
        get: async (reference) => {
          const value = getCollection(reference.collection).get(reference.id);
          return {
            exists: value !== undefined,
            id: reference.id,
            data: () => value && structuredClone(value),
          };
        },
        create: (reference, value) => {
          const documents = getCollection(reference.collection);
          if (documents.has(reference.id)) throw new Error("Duplicate document.");
          documents.set(reference.id, structuredClone(value));
        },
        set: (reference, value) => {
          getCollection(reference.collection).set(reference.id, structuredClone(value));
        },
        update: (reference, updates) => {
          const documents = getCollection(reference.collection);
          if (!documents.has(reference.id)) throw new Error("Missing document.");
          documents.set(reference.id, { ...documents.get(reference.id), ...structuredClone(updates) });
        },
      });
    },
  };
}

async function withWebhookServer(run, overrides = {}) {
  const database = createDatabase();
  const sentMessages = [];
  const teamNotifications = [];
  const app = express();
  app.use(express.json({ verify: (request, _response, buffer) => { request.rawBody = Buffer.from(buffer); } }));
  registerWhatsAppWebhookRoutes(app, {
    getDb: () => database,
    env: {
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      META_APP_SECRET: APP_SECRET,
      WHATSAPP_ACCESS_TOKEN: ACCESS_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
      WHATSAPP_GRAPH_API_VERSION: "v22.0",
    },
    interpretMessage: async () => ({ args: {} }),
    notifyTeam: async (notification) => { teamNotifications.push(notification); },
    authorizeAdmin: async (request) => request.headers.authorization === "Bearer admin"
      ? { uid: "authorized-admin" }
      : null,
    isMarketplaceOpen: () => true,
    now: () => Date.now(),
    fetchImpl: async (url, options) => {
      sentMessages.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.reply-${sentMessages.length}` }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    ...overrides,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, {
      database,
      sentMessages,
      teamNotifications,
    });
  } finally {
    const closed = once(server, "close");
    server.close();
    await closed;
  }
}

function sign(body, secret = APP_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function messagePayload({ id, sender = "15551234567", text, timestamp = String(Math.floor(Date.now() / 1000)), phoneNumberId = PHONE_NUMBER_ID }) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [{
            id,
            from: sender,
            timestamp,
            type: "text",
            text: { body: text },
          }],
        },
      }],
    }],
  };
}

test("WhatsApp webhook events match profile names by wa_id across messages and omit names on status events", () => {
  const [message1, message2, message3, message4, status] = extractWhatsAppWebhookEvents({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [
            { wa_id: "15551234567", profile: { name: "  Ada   Lovelace " } },
            { wa_id: "16661234567", profile: { name: "Grace Hopper" } },
            { wa_id: "17771234567", profile: { name: "Does Not Match" } },
            { wa_id: "18881234567", profile: { name: "  " } },
          ],
          messages: [
            { id: "wamid.profile-1", from: "15551234567", timestamp: "1794382800", type: "text", text: { body: "Hi" } },
            { id: "wamid.profile-2", from: "16661234567", timestamp: "1794382800", type: "text", text: { body: "Hello" } },
            { id: "wamid.profile-3", from: "19991234567", timestamp: "1794382800", type: "text", text: { body: "No profile" } },
            { id: "wamid.profile-4", from: "15551234567", timestamp: "1794382800", type: "text", text: { body: "Again" } },
          ],
          statuses: [
            { id: "wamid.status-1", recipient_id: "15551234567", status: "delivered", timestamp: "1794382800" },
          ],
        },
      }],
    }],
  });

  assert.equal(message1.whatsappProfileName, "Ada Lovelace");
  assert.equal(message2.whatsappProfileName, "Grace Hopper");
  assert.equal(message3.whatsappProfileName, "");
  assert.equal(message4.whatsappProfileName, "Ada Lovelace");
  assert.equal(Object.hasOwn(status, "whatsappProfileName"), false);
  assert.equal(status.eventType, "message_status");

  const statusOnly = extractWhatsAppWebhookEvents({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ wa_id: "15551234567", profile: { name: "Ada Lovelace" } }],
          statuses: [{ id: "wamid.status-only", recipient_id: "15551234567", status: "read", timestamp: "1794382800" }],
        },
      }],
    }],
  });
  assert.equal(statusOnly.length, 1);
  assert.equal(statusOnly[0].eventType, "message_status");
  assert.equal(Object.hasOwn(statusOnly[0], "whatsappProfileName"), false);
});

async function sendWebhook(baseUrl, payload, secret = APP_SECRET) {
  const body = JSON.stringify(payload);
  return fetch(`${baseUrl}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": sign(body, secret) },
    body,
  });
}

function storedDocuments(database, name) {
  return [...(database.collections.get(name)?.values() || [])];
}

test("local simulator keeps multiple conversations isolated and reuses bot, enquiry, and takeover logic", async () => {
  const simulator = createWhatsAppSimulator({
    now: () => Date.now(),
    isMarketplaceOpen: () => true,
    interpretMessage: async ({ message }) => message.includes("complete request")
      ? {
        args: {
          vehicle: { manufacturer: "Tata", model: "LPT 1612", year: "2019" },
          partName: "clutch",
          quantity: 2,
        },
      }
      : { args: {} },
  });
  const first = simulator.createConversation();
  const second = simulator.createConversation();
  assert.notEqual(first.id, second.id);
  assert.equal(first.label, "Customer 1");
  assert.equal(second.label, "Customer 2");
  assert.equal(simulator.setMode(second.id, "human").mode, "human");

  const firstAfter = await simulator.sendMessage(first.id, "complete request for Tata LPT 1612 2019 clutch quantity 2");
  assert.equal(firstAfter.status, "quote_requested");
  assert.equal(firstAfter.enquiries.length, 1);
  assert.equal(firstAfter.enquiries[0].partName, "clutch");
  assert.equal(firstAfter.enquiries[0].quantity, 2);
  assert.equal(firstAfter.messages.at(-1).role, "assistant");

  const secondAfter = await simulator.sendMessage(second.id, "I would like to ask about a part");
  assert.equal(secondAfter.mode, "human");
  assert.equal(secondAfter.messages.at(-1).role, "user");
  assert.equal(simulator.getConversation(first.id).enquiries.length, 1);

  const resumed = simulator.setMode(second.id, "bot");
  assert.equal(resumed.mode, "bot");
});

test("simulator accumulates a passenger-car request without inventing a manufacturer", async () => {
  const simulator = createWhatsAppSimulator({
    isMarketplaceOpen: () => true,
    interpretMessage: async ({ message }) => message.includes("Swift")
      ? {
        args: {
          vehicle: { manufacturer: "Maruti Suzuki", model: "Swift" },
          partName: "brake pads",
        },
      }
      : { args: {} },
  });
  const customer = simulator.createConversation();
  const otherCustomer = simulator.createConversation();

  let conversation = await simulator.sendMessage(customer.id, "Hi");
  assert.match(conversation.messages.at(-1).text, /what vehicle and part/i);
  conversation = await simulator.sendMessage(customer.id, "I need brake pads for Swift");
  assert.equal(conversation.slots.vehicleMake, "");
  assert.equal(conversation.slots.vehicleModel, "Swift");
  assert.equal(conversation.slots.partName, "brake pads");
  assert.match(conversation.messages.at(-1).text, /vehicle make/i);
  assert.match(conversation.messages.at(-1).text, /vehicle year/i);
  assert.match(conversation.messages.at(-1).text, /quantity/i);
  assert.doesNotMatch(conversation.messages.at(-1).text, /truck model/i);

  conversation = await simulator.sendMessage(customer.id, "2020 model");
  assert.equal(conversation.slots.vehicleYear, "2020");
  assert.equal(conversation.slots.vehicleModel, "Swift");
  assert.match(conversation.messages.at(-1).text, /vehicle make/i);
  assert.doesNotMatch(conversation.messages.at(-1).text, /vehicle year/i);
  assert.doesNotMatch(conversation.messages.at(-1).text, /brake pads/i);

  conversation = await simulator.sendMessage(customer.id, "Front");
  assert.equal(conversation.slots.partPosition, "front");
  conversation = await simulator.sendMessage(customer.id, "2 sets");
  assert.equal(conversation.slots.quantity, 2);
  assert.equal(conversation.slots.quantityUnit, "sets");
  assert.equal(conversation.enquiries.length, 0);
  assert.deepEqual(conversation.slots, {
    vehicleMake: "",
    vehicleMakeConfirmed: false,
    vehicleModel: "Swift",
    vehicleYear: "2020",
    partName: "brake pads",
    partNumber: "",
    quantity: 2,
    quantityUnit: "sets",
    partPosition: "front",
  });
  assert.match(conversation.messages.at(-1).text, /vehicle make/i);
  assert.doesNotMatch(conversation.messages.at(-1).text, /model|year|brake pads|position|quantity|sets/i);
  assert.equal(simulator.getConversation(otherCustomer.id).messages.length, 0);
  assert.equal(simulator.getConversation(otherCustomer.id).slots.vehicleModel, "");
});

test("simulator HTTP flow persists every extracted field and handles HUMAN, AGENT, and START", async () => {
  let aiCalls = 0;
  const simulator = createWhatsAppSimulator({
    isMarketplaceOpen: () => true,
    interpretMessage: async ({ message }) => {
      aiCalls += 1;
      if (message === "I need brake pads for Swift") {
        return {
          args: {
            vehicle: { manufacturer: "Maruti Suzuki", model: "Swift" },
            partName: "brake pads",
          },
        };
      }
      if (message === "2020 model") {
        return { args: { vehicle: { model: "2020 model", year: "2020" } } };
      }
      if (message === "Front") {
        return { args: { vehicle: { model: "Swift" }, partPosition: "front" } };
      }
      if (message === "2 sets") {
        return { args: { quantity: 2, quantityUnit: "sets" } };
      }
      return { args: {} };
    },
  });
  const app = express();
  app.use(express.json());
  registerWhatsAppSimulatorRoutes(app, {
    simulator,
    env: { NODE_ENV: "development", WHATSAPP_SIMULATOR_ENABLED: "true" },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const root = `http://127.0.0.1:${address.port}/api/dev/whatsapp-simulator/conversations`;

  async function getConversation(id) {
    const response = await fetch(`${root}/${id}`);
    assert.equal(response.status, 200);
    return (await response.json()).conversation;
  }

  async function sendMessage(id, text) {
    const response = await fetch(`${root}/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    assert.equal(response.status, 200, `HTTP simulator failed for message: ${text}`);
    const updated = (await response.json()).conversation;
    const persisted = await getConversation(id);
    assert.deepEqual(updated, persisted, "message endpoint must return persisted conversation state");
    return persisted;
  }

  try {
    const createResponse = await fetch(root, { method: "POST" });
    assert.equal(createResponse.status, 201);
    const { conversation: created } = await createResponse.json();
    const id = created.id;

    let conversation = await sendMessage(id, "Hi");
    assert.match(conversation.messages.at(-1).text, /welcome to PARTSWALA/i);

    conversation = await sendMessage(id, "I need brake pads for Swift");
    assert.equal(conversation.slots.vehicleMake, "");
    assert.equal(conversation.slots.vehicleModel, "Swift");
    assert.equal(conversation.slots.partName, "brake pads");
    assert.match(conversation.messages.at(-1).text, /vehicle make/i);
    assert.match(conversation.messages.at(-1).text, /vehicle year/i);
    assert.match(conversation.messages.at(-1).text, /quantity/i);
    assert.doesNotMatch(conversation.messages.at(-1).text, /truck/i);

    conversation = await sendMessage(id, "2020 model");
    assert.equal(conversation.slots.vehicleModel, "Swift");
    assert.equal(conversation.slots.vehicleYear, "2020");
    assert.match(conversation.messages.at(-1).text, /vehicle make/i);
    assert.match(conversation.messages.at(-1).text, /quantity/i);
    assert.doesNotMatch(conversation.messages.at(-1).text, /vehicle year|brake pads|truck/i);

    conversation = await sendMessage(id, "Front");
    assert.equal(conversation.slots.partPosition, "front");
    assert.match(conversation.messages.at(-1).text, /vehicle make/i);
    assert.match(conversation.messages.at(-1).text, /quantity/i);

    conversation = await sendMessage(id, "2 sets");
    assert.deepEqual(conversation.slots, {
      vehicleMake: "",
      vehicleMakeConfirmed: false,
      vehicleModel: "Swift",
      vehicleYear: "2020",
      partName: "brake pads",
      partNumber: "",
      quantity: 2,
      quantityUnit: "sets",
      partPosition: "front",
    });
    assert.match(conversation.messages.at(-1).text, /vehicle make/i);
    assert.doesNotMatch(conversation.messages.at(-1).text, /model|year|brake pads|position|quantity|sets|truck/i);

    const callsBeforeCommands = aiCalls;
    conversation = await sendMessage(id, "HUMAN");
    assert.equal(conversation.mode, "human");
    assert.match(conversation.messages.at(-1).text, /automated replies are paused/i);
    assert.equal(conversation.slots.vehicleMake, "");
    assert.equal(aiCalls, callsBeforeCommands);

    conversation = await sendMessage(id, "START");
    assert.equal(conversation.mode, "bot");
    assert.equal(conversation.status, "collecting_details");
    assert.match(conversation.messages.at(-1).text, /automated help is back on/i);
    assert.match(conversation.messages.at(-1).text, /vehicle make/i);
    assert.deepEqual(conversation.slots, {
      vehicleMake: "",
      vehicleMakeConfirmed: false,
      vehicleModel: "Swift",
      vehicleYear: "2020",
      partName: "brake pads",
      partNumber: "",
      quantity: 2,
      quantityUnit: "sets",
      partPosition: "front",
    });
    assert.equal(aiCalls, callsBeforeCommands);

    const startMessageCount = conversation.messages.length;
    conversation = await sendMessage(id, "Hi");
    assert.equal(conversation.mode, "bot");
    assert.equal(conversation.status, "collecting_details");
    assert.equal(conversation.messages.length, startMessageCount + 2);
    assert.match(conversation.messages.at(-1).text, /vehicle make/i);
    assert.doesNotMatch(conversation.messages.at(-1).text, /human takeover is active|bot replies are paused/i);
    assert.deepEqual(conversation.slots, {
      vehicleMake: "",
      vehicleMakeConfirmed: false,
      vehicleModel: "Swift",
      vehicleYear: "2020",
      partName: "brake pads",
      partNumber: "",
      quantity: 2,
      quantityUnit: "sets",
      partPosition: "front",
    });
    assert.equal(aiCalls, callsBeforeCommands + 1);

    conversation = await sendMessage(id, "Maruti Suzuki");
    assert.deepEqual(conversation.slots, {
      vehicleMake: "Maruti Suzuki",
      vehicleMakeConfirmed: true,
      vehicleModel: "Swift",
      vehicleYear: "2020",
      partName: "brake pads",
      partNumber: "",
      quantity: 2,
      quantityUnit: "sets",
      partPosition: "front",
    });
    assert.equal(conversation.status, "quote_requested");
    assert.equal(conversation.enquiries.length, 1);
    assert.deepEqual({
      vehicleMake: conversation.enquiries[0].vehicleMake,
      vehicleModel: conversation.enquiries[0].vehicleModel,
      vehicleYear: conversation.enquiries[0].vehicleYear,
      partName: conversation.enquiries[0].partName,
      partPosition: conversation.enquiries[0].partPosition,
      quantity: conversation.enquiries[0].quantity,
      quantityUnit: conversation.enquiries[0].quantityUnit,
    }, {
      vehicleMake: "Maruti Suzuki",
      vehicleModel: "Swift",
      vehicleYear: "2020",
      partName: "brake pads",
      partPosition: "front",
      quantity: 2,
      quantityUnit: "sets",
    });
    assert.match(conversation.messages.at(-1).text, /sent your request to our team/i);
    assert.doesNotMatch(conversation.messages.at(-1).text, /vehicle make/i);
    assert.equal(aiCalls, callsBeforeCommands + 2);

    conversation = await sendMessage(id, "AGENT");
    assert.equal(conversation.mode, "human");
    assert.equal(conversation.status, "human_takeover");
    assert.match(conversation.messages.at(-1).text, /automated replies are paused/i);
    assert.equal(aiCalls, callsBeforeCommands + 2);

    conversation = await sendMessage(id, "START");
    assert.equal(conversation.mode, "bot");
    assert.equal(conversation.status, "quote_requested");
    assert.match(conversation.messages.at(-1).text, /automated help is back on/i);
    assert.equal(aiCalls, callsBeforeCommands + 2);
  } finally {
    const closed = once(server, "close");
    server.close();
    await closed;
  }
});

test("generic vehicle categories are not mistaken for truck models", async () => {
  const simulator = createWhatsAppSimulator({
    isMarketplaceOpen: () => true,
    interpretMessage: async ({ message }) => {
      const vehicleType = ["car", "SUV", "bike", "truck", "van"].find((type) =>
        message.toLowerCase().includes(type.toLowerCase()));
      return { args: { vehicle: { model: vehicleType || "" } } };
    },
  });
  for (const [index, vehicle] of ["car", "SUV", "bike", "truck", "van"].entries()) {
    const conversation = simulator.createConversation();
    const result = await simulator.sendMessage(conversation.id, `I need a headlight for my ${vehicle}`);
    assert.equal(result.slots.vehicleModel, "", `${vehicle} should not be stored as a model`);
    assert.match(result.messages.at(-1).text, /vehicle make and vehicle model/i);
    assert.equal(index + 1, simulator.listConversations().length);
  }
});

test("simulator HTTP routes are loopback-only and disabled in production", async () => {
  const simulator = createWhatsAppSimulator({ isMarketplaceOpen: () => true });
  const app = express();
  app.use(express.json());
  registerWhatsAppSimulatorRoutes(app, {
    simulator,
    env: { NODE_ENV: "development", WHATSAPP_SIMULATOR_ENABLED: "true" },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    const createResponse = await fetch(`http://127.0.0.1:${address.port}/api/dev/whatsapp-simulator/conversations`, { method: "POST" });
    assert.equal(createResponse.status, 201);
    const { conversation } = await createResponse.json();
    const sendResponse = await fetch(`http://127.0.0.1:${address.port}/api/dev/whatsapp-simulator/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(sendResponse.status, 200);
  } finally {
    const closed = once(server, "close");
    server.close();
    await closed;
  }

  const productionApp = express();
  registerWhatsAppSimulatorRoutes(productionApp, {
    simulator,
    env: { NODE_ENV: "production", WHATSAPP_SIMULATOR_ENABLED: "true" },
  });
  const productionServer = productionApp.listen(0, "127.0.0.1");
  await once(productionServer, "listening");
  const productionAddress = productionServer.address();
  try {
    const hidden = await fetch(`http://127.0.0.1:${productionAddress.port}/api/dev/whatsapp-simulator/conversations`);
    assert.equal(hidden.status, 404);
  } finally {
    const closed = once(productionServer, "close");
    productionServer.close();
    await closed;
  }
});

test("GET webhook verifies subscription and returns the challenge", async () => {
  await withWebhookServer(async (baseUrl) => {
    const query = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "challenge-value-123",
    });
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp?${query}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "challenge-value-123");
  });
});

test("ambiguous 5xx delivery outcomes are not resent on duplicate webhook delivery", async () => {
  let fetchCalls = 0;
  await withWebhookServer(async (baseUrl, { database }) => {
    const payload = messagePayload({ id: "wamid.ambiguous-delivery", text: "hello" });
    const first = await sendWebhook(baseUrl, payload);
    assert.equal(first.status, 200);
    const duplicate = await sendWebhook(baseUrl, payload);
    assert.deepEqual(await duplicate.json(), { ok: true, processed: 0, duplicates: 1 });
    assert.equal(fetchCalls, 1);
    assert.equal(storedDocuments(database, "whatsappOutboundMessages")[0].status, "uncertain");
  }, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("unknown provider state", { status: 503 });
    },
  });
});

test("GET webhook rejects invalid mode or verification token without disclosing configuration", async () => {
  await withWebhookServer(async (baseUrl) => {
    for (const [mode, token] of [["subscribe", "wrong-token"], ["not-subscribe", VERIFY_TOKEN]]) {
      const query = new URLSearchParams({
        "hub.mode": mode,
        "hub.verify_token": token,
        "hub.challenge": "must-not-be-returned",
      });
      const response = await fetch(`${baseUrl}/api/webhooks/whatsapp?${query}`);
      assert.equal(response.status, 403);
      const body = await response.text();
      assert.doesNotMatch(body, new RegExp(VERIFY_TOKEN));
    }
  });
});

test("incoming text gets a first-time welcome, quote-first prompt, and a server-only API reply", async () => {
  const privateMessage = "Hello, I need a truck part";
  await withWebhookServer(async (baseUrl, { database, sentMessages }) => {
    const response = await sendWebhook(baseUrl, messagePayload({ id: "wamid.welcome-1", text: privateMessage }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, processed: 1, duplicates: 0 });
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].url, `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`);
    assert.equal(sentMessages[0].options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
    assert.equal(sentMessages[0].body.to, "15551234567");
    assert.match(sentMessages[0].body.text.body, /welcome to PARTSWALA/i);
    assert.match(sentMessages[0].body.text.body, /what vehicle and part do you need help with/i);
    assert.doesNotMatch(sentMessages[0].body.text.body, /truck model|vehicle year|quantity/i);
    assert.doesNotMatch(sentMessages[0].body.text.body, /₹|available now|confirmed/i);
    const [event] = storedDocuments(database, "whatsappWebhookEvents");
    assert.equal(Object.hasOwn(event, "text"), false);
    assert.equal(JSON.stringify(event).includes(privateMessage), false);
    assert.equal(storedDocuments(database, "whatsappConversations")[0].messages[0].text, privateMessage);
  });
});

test("matching WhatsApp profile names persist by phone identity and reach AI without entering event metadata", async () => {
  const aiContexts = [];
  await withWebhookServer(async (baseUrl, { database }) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = (messages, contacts = [], statuses = []) => ({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: PHONE_NUMBER_ID },
            contacts,
            messages,
            statuses,
          },
        }],
      }],
    });

    let response = await sendWebhook(baseUrl, payload([
      { id: "wamid.profile-http-1", from: "15551234567", timestamp, type: "text", text: { body: "Hi" } },
      { id: "wamid.profile-http-2", from: "15551234567", timestamp, type: "text", text: { body: "I need a part" } },
    ], [
      { wa_id: "15551234567", profile: { name: "Riya Sharma" } },
      { wa_id: "16661234567", profile: { name: "Wrong Customer" } },
    ]));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, processed: 2, duplicates: 0 });

    response = await sendWebhook(baseUrl, payload([
      { id: "wamid.profile-http-3", from: "15551234567", timestamp, type: "text", text: { body: "Another question" } },
      { id: "wamid.profile-http-4", from: "19991234567", timestamp, type: "text", text: { body: "No profile available" } },
    ], [
      { wa_id: "18881234567", profile: { name: "Must Not Match" } },
    ], [
      { id: "wamid.profile-status", recipient_id: "15551234567", status: "delivered", timestamp },
    ]));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, processed: 3, duplicates: 0 });

    response = await sendWebhook(baseUrl, payload([], [
      { wa_id: "15551234567", profile: { name: "Riya Sharma" } },
    ], [
      { id: "wamid.profile-status-only", recipient_id: "15551234567", status: "read", timestamp },
    ]));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, processed: 1, duplicates: 0 });
    assert.equal(aiContexts.length, 4, "status-only event must not invoke message interpretation");

    const conversations = storedDocuments(database, "whatsappConversations");
    const riyaConversation = conversations.find((conversation) => conversation.senderId === "15551234567");
    const unnamedConversation = conversations.find((conversation) => conversation.senderId === "19991234567");
    assert.equal(conversations.length, 2, "phone number remains the stable conversation identity");
    assert.equal(riyaConversation.whatsappProfileName, "Riya Sharma");
    assert.equal(unnamedConversation.whatsappProfileName, "");
    assert.deepEqual(aiContexts.map(({ message, whatsappProfileName }) => ({ message, whatsappProfileName })), [
      { message: "Hi", whatsappProfileName: "Riya Sharma" },
      { message: "I need a part", whatsappProfileName: "Riya Sharma" },
      { message: "Another question", whatsappProfileName: "Riya Sharma" },
      { message: "No profile available", whatsappProfileName: "" },
    ]);

    const webhookEvents = storedDocuments(database, "whatsappWebhookEvents");
    assert.equal(webhookEvents.length, 6);
    assert.equal(webhookEvents.some((event) => Object.hasOwn(event, "whatsappProfileName")), false);
    assert.equal(webhookEvents.some((event) => event.eventType === "message_status"), true);
  }, {
    interpretMessage: async (context) => {
      aiContexts.push(context);
      return { args: {} };
    },
  });
});

test("AI-extracted customer details create one structured quote enquiry and notify the team", async () => {
  const interpretation = {
    args: {
      vehicle: { manufacturer: "Tata", model: "LPT 1612", year: "2019" },
      partName: "clutch",
      partNumber: "TATA-CL-19",
      quantity: 2,
    },
  };
  await withWebhookServer(async (baseUrl, { database, sentMessages, teamNotifications }) => {
    const response = await sendWebhook(baseUrl, messagePayload({
      id: "wamid.enquiry-1",
      text: "Please quote me a clutch for my 2019 Tata LPT 1612, part TATA-CL-19, quantity 2.",
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).processed, 1);
    const enquiries = storedDocuments(database, "whatsappEnquiries");
    assert.equal(enquiries.length, 1);
    assert.match(enquiries[0].id, /^[0-9a-f-]{36}$/i);
    assert.equal(enquiries[0].vehicleMake, "Tata");
    assert.equal(enquiries[0].vehicleModel, "LPT 1612");
    assert.equal(enquiries[0].vehicleYear, "2019");
    assert.equal(enquiries[0].partName, "clutch");
    assert.equal(enquiries[0].partNumber, "TATA-CL-19");
    assert.equal(enquiries[0].quantity, 2);
    assert.equal(enquiries[0].status, "new");
    assert.equal(enquiries[0].conversationStatus, "quote_requested");
    assert.deepEqual(teamNotifications.map(({ type }) => type), ["enquiry"]);
    assert.match(sentMessages[0].body.text.body, /confirm availability and pricing with a quote/i);
    assert.match(sentMessages[0].body.text.body, /nothing has been ordered or paid for/i);
  }, {
    interpretMessage: async () => interpretation,
  });
});

test("natural-language store questions use the AI intent and existing server-side store information", async () => {
  await withWebhookServer(async (baseUrl, { database, sentMessages }) => {
    const response = await sendWebhook(baseUrl, messagePayload({
      id: "wamid.store-question",
      text: "What is your return policy?",
    }));
    assert.equal(response.status, 200);
    assert.equal(storedDocuments(database, "whatsappEnquiries").length, 0);
    assert.match(sentMessages[0].body.text.body, /Configured return policy/i);
    assert.doesNotMatch(sentMessages[0].body.text.body, /₹|available now|vendor confirmed/i);
  }, {
    interpretMessage: async () => ({ action: "getStoreInfo", args: { query: "return policy" } }),
    answerQuestion: async (intent) => {
      assert.equal(intent.action, "getStoreInfo");
      return "Configured return policy: contact support for return eligibility.";
    },
  });
});

test("bot asks only for missing details and creates the enquiry when the customer supplies them", async () => {
  await withWebhookServer(async (baseUrl, { database, sentMessages }) => {
    let response = await sendWebhook(baseUrl, messagePayload({
      id: "wamid.partial-1",
      text: "I need a brake pad for my Tata truck",
    }));
    assert.equal(response.status, 200);
    assert.match(sentMessages[0].body.text.body, /vehicle model/i);
    assert.doesNotMatch(sentMessages[0].body.text.body, /truck model/i);
    assert.match(sentMessages[0].body.text.body, /vehicle year/i);
    assert.match(sentMessages[0].body.text.body, /quantity/i);
    assert.equal(storedDocuments(database, "whatsappEnquiries").length, 0);

    response = await sendWebhook(baseUrl, messagePayload({
      id: "wamid.partial-2",
      text: "It is an LPT 1612, year 2020, part BP-20, quantity 4",
    }));
    assert.equal(response.status, 200);
    const enquiries = storedDocuments(database, "whatsappEnquiries");
    assert.equal(enquiries.length, 1);
    assert.equal(enquiries[0].vehicleMake, "Tata");
    assert.equal(enquiries[0].vehicleModel, "LPT 1612");
    assert.equal(enquiries[0].vehicleYear, "2020");
    assert.equal(enquiries[0].partName, "brake pad");
    assert.equal(enquiries[0].partNumber, "BP-20");
    assert.equal(enquiries[0].quantity, 4);
  }, {
    interpretMessage: async ({ message }) => message.startsWith("I need")
      ? { args: { vehicle: { manufacturer: "Tata" }, partName: "brake pad" } }
      : {
        args: {
          vehicle: { model: "LPT 1612", year: "2020" },
          partNumber: "BP-20",
          quantity: 4,
        },
      },
  });
});

test("HUMAN and AGENT pause bot replies until START, and authorized admins can control takeover", async () => {
  let aiCalls = 0;
  await withWebhookServer(async (baseUrl, { database, sentMessages, teamNotifications }) => {
    let response = await sendWebhook(baseUrl, messagePayload({ id: "wamid.human-1", text: "HUMAN" }));
    assert.equal(response.status, 200);
    assert.match(sentMessages[0].body.text.body, /notified our team/i);
    assert.equal(teamNotifications[0].type, "human-request");

    response = await sendWebhook(baseUrl, messagePayload({ id: "wamid.human-agent", text: "AGENT" }));
    assert.equal(response.status, 200);
    assert.equal(teamNotifications[1].type, "human-request");

    response = await sendWebhook(baseUrl, messagePayload({ id: "wamid.human-2", text: "I need a clutch" }));
    assert.equal(response.status, 200);
    assert.equal(sentMessages.length, 2);

    const conversationId = [...database.collections.get("whatsappConversations").keys()][0];
    const forbidden = await fetch(`${baseUrl}/api/admin/whatsapp/conversations/${conversationId}`);
    assert.equal(forbidden.status, 403);

    response = await sendWebhook(baseUrl, messagePayload({ id: "wamid.human-3", text: "START" }));
    assert.equal(response.status, 200);
    assert.equal(sentMessages.length, 3);
    assert.match(sentMessages[2].body.text.body, /automated help is back on/i);

    const takeover = await fetch(`${baseUrl}/api/admin/whatsapp/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { authorization: "Bearer admin", "content-type": "application/json" },
      body: JSON.stringify({ mode: "human" }),
    });
    assert.equal(takeover.status, 200);
    response = await sendWebhook(baseUrl, messagePayload({ id: "wamid.human-4", text: "I still need a clutch" }));
    assert.equal(response.status, 200);
    assert.equal(sentMessages.length, 3);
  }, {
    interpretMessage: async () => {
      aiCalls += 1;
      return { args: {} };
    },
  });
  assert.equal(aiCalls, 0, "commands and messages during takeover must bypass AI interpretation");
});

test("duplicate webhook deliveries do not create or send duplicate replies", async () => {
  await withWebhookServer(async (baseUrl, { database, sentMessages }) => {
    const payload = messagePayload({ id: "wamid.duplicate-1", text: "hello" });
    const first = await sendWebhook(baseUrl, payload);
    assert.deepEqual(await first.json(), { ok: true, processed: 1, duplicates: 0 });
    const duplicate = await sendWebhook(baseUrl, payload);
    assert.deepEqual(await duplicate.json(), { ok: true, processed: 0, duplicates: 1 });
    assert.equal(sentMessages.length, 1);
    assert.equal(storedDocuments(database, "whatsappConversations").length, 1);
    assert.equal(storedDocuments(database, "whatsappOutboundMessages").length, 1);
  });
});

test("signature validation rejects invalid signatures before processing", async () => {
  await withWebhookServer(async (baseUrl, { database }) => {
    const body = JSON.stringify(messagePayload({ id: "wamid.bad-signature", text: "private message" }));
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body, "wrong-secret") },
      body,
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: "Invalid webhook signature." });
    assert.equal(storedDocuments(database, "whatsappWebhookEvents").length, 0);
  });
});

test("WhatsApp API rate limits retry once with a bounded delay", async () => {
  let fetchCalls = 0;
  await withWebhookServer(async (baseUrl, { database }) => {
    const response = await sendWebhook(baseUrl, messagePayload({ id: "wamid.api-retry", text: "hello" }));
    assert.equal(response.status, 200);
    assert.equal(fetchCalls, 2);
    const outbox = storedDocuments(database, "whatsappOutboundMessages")[0];
    assert.equal(outbox.status, "sent");
  }, {
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0.001" } });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.reply-retried" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
});

test("a rejected WhatsApp API delivery can be retried safely on Meta webhook redelivery", async () => {
  let fetchCalls = 0;
  await withWebhookServer(async (baseUrl, { database }) => {
    const payload = messagePayload({ id: "wamid.api-redelivery", text: "hello" });
    const failed = await sendWebhook(baseUrl, payload);
    assert.equal(failed.status, 500);
    const retried = await sendWebhook(baseUrl, payload);
    assert.equal(retried.status, 200);
    assert.equal(fetchCalls, 2);
    assert.equal(storedDocuments(database, "whatsappConversations").length, 1);
    assert.equal(storedDocuments(database, "whatsappEnquiries").length, 0);
  }, {
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return new Response("configuration error", { status: 400 });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.reply-after-redelivery" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
});

test("unknown delivery outcomes are not resent automatically and messages outside the service window are ignored", async () => {
  await withWebhookServer(async (baseUrl, { database, sentMessages }) => {
    const oldTimestamp = String(Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000));
    const response = await sendWebhook(baseUrl, messagePayload({
      id: "wamid.old-window",
      text: "hello",
      timestamp: oldTimestamp,
    }));
    assert.equal(response.status, 200);
    assert.equal(sentMessages.length, 0);
    assert.equal(storedDocuments(database, "whatsappConversations").length, 0);
  });
});

test("admin enquiry review and conversation history require authorized backend access", async () => {
  await withWebhookServer(async (baseUrl, { database }) => {
    const response = await sendWebhook(baseUrl, messagePayload({
      id: "wamid.admin-review",
      sender: "15557654321",
      text: "a private customer message",
    }));
    assert.equal(response.status, 200);
    const conversationId = [...database.collections.get("whatsappConversations").keys()][0];
    const list = await fetch(`${baseUrl}/api/admin/whatsapp/enquiries`, {
      headers: { authorization: "Bearer admin" },
    });
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { enquiries: [] });
    const detail = await fetch(`${baseUrl}/api/admin/whatsapp/conversations/${conversationId}`, {
      headers: { authorization: "Bearer admin" },
    });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).messages[0].text, "a private customer message");
  });
});
