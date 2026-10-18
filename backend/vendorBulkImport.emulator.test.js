import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import XLSX from "xlsx";

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
const isLoopbackHost = (value) => /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value);
const emulatorConfigured = projectId.startsWith("demo-")
  && isLoopbackHost(firestoreHost)
  && isLoopbackHost(authHost);

async function emulatorRequest(host, path, options) {
  const response = await fetch(`http://${host}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Firebase emulator request failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

test("authenticated vendor bulk import routes use isolated Auth and Firestore emulators", {
  skip: !emulatorConfigured && "Run with the configured demo-project Firebase emulators.",
}, async (t) => {
  assert.equal(projectId.startsWith("demo-"), true);
  assert.equal(isLoopbackHost(firestoreHost), true);
  assert.equal(isLoopbackHost(authHost), true);

  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
  process.env.FIREBASE_CLIENT_EMAIL = "vendor-import-test@example.test";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n");

  const { cert, getApp, getApps, initializeApp } = await import("firebase-admin/app");
  const firebaseApp = getApps().find(({ name }) => name === "[DEFAULT]") || initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    projectId,
  });
  assert.equal(firebaseApp.options.projectId, projectId);
  const { default: app } = await import("./server.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  const database = getFirestore(getApp());
  const createdAccounts = [];
  const createdVendorIds = [];
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const api = `http://127.0.0.1:${address.port}`;

  async function createVendor(status = "approved") {
    const email = `vendor-${randomUUID()}@example.test`;
    const account = await emulatorRequest(
      authHost,
      `/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "LocalEmulatorPass123!", returnSecureToken: true }),
      },
    );
    createdAccounts.push(account.idToken);
    createdVendorIds.push(account.localId);
    await database.collection("users").doc(account.localId).set({ role: "vendor", vendorStatus: status });
    return { uid: account.localId, token: account.idToken };
  }

  async function importFile(vendor, workbook, confirm = true, claimedVendorId = "") {
    const form = new FormData();
    form.append("file", new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "vendor-import.xlsx");
    if (confirm) form.append("confirm", "true");
    if (claimedVendorId) form.append("vendorId", claimedVendorId);
    return fetch(`${api}/api/vendor/import-products`, {
      method: "POST",
      headers: { Authorization: `Bearer ${vendor.token}` },
      body: form,
    });
  }

  async function downloadTemplate(vendor) {
    return fetch(`${api}/api/vendor/import-template`, {
      headers: { Authorization: ["Bearer", vendor.token].join(" ") },
    });
  }

  const workbookRow = (name, partNumber, brand, price = "1250") => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Part Name", "Part Number", "Brand", "Category", "Price in INR", "MOQ", "Availability"],
      [name, partNumber, brand, "Filters", price, 1, 5],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Products");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  };

  async function deleteVendorData() {
    const references = [];
    for (const uid of createdVendorIds) {
      const [products, jobs] = await Promise.all([
        database.collection("products").where("sellerId", "==", uid).get(),
        database.collection("vendorImportJobs").where("vendorId", "==", uid).get(),
      ]);
      references.push(...products.docs.map((snapshot) => snapshot.ref));
      references.push(...jobs.docs.map((snapshot) => snapshot.ref));
      references.push(database.collection("users").doc(uid));
    }
    for (let index = 0; index < references.length; index += 400) {
      const batch = database.batch();
      references.slice(index, index + 400).forEach((reference) => batch.delete(reference));
      await batch.commit();
    }
    await Promise.all(createdAccounts.map((idToken) =>
      emulatorRequest(authHost, "/identitytoolkit.googleapis.com/v1/accounts:delete?key=local-emulator-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }).catch((error) => {
        if (!String(error.message).includes("INVALID_ID_TOKEN")) throw error;
      }),
    ));
  }

  try {
    await t.test("approved vendors can download the Excel template; pending vendors cannot", async () => {
      const pendingVendor = await createVendor("pending");
      const pendingResponse = await downloadTemplate(pendingVendor);
      assert.equal(pendingResponse.status, 403);

      const approvedVendor = await createVendor();
      const response = await downloadTemplate(approvedVendor);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /spreadsheetml\.sheet/);
      assert.match(response.headers.get("content-disposition"), /vendor-product-import-template\.xlsx/);
      const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
      assert.equal(workbook.SheetNames[0], "Products");
      assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Products, { header: 1 })[0][0], "Part Name");
    });

    await t.test("preview requires authentication and derives ownership from the token", async () => {
      const unauthenticated = await fetch(`${api}/api/vendor/import-products`, {
        method: "POST",
        body: new FormData(),
      });
      assert.equal(unauthenticated.status, 401);

      const vendor = await createVendor();
      const response = await importFile(vendor, workbookRow("Preview part", "PREVIEW-100", "Acme"), false, "forged-vendor-id");
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.importMode, "preview");
      assert.equal(result.rows[0].sellerId, vendor.uid);
      assert.notEqual(result.rows[0].sellerId, "forged-vendor-id");
      assert.equal((await database.collection("products").where("sellerId", "==", vendor.uid).get()).size, 0);
    });

    await t.test("unapproved vendors cannot preview or import", async () => {
      const vendor = await createVendor("pending");
      const preview = await importFile(vendor, workbookRow("Pending part", "P-100", "Test"), false);
      const confirmed = await importFile(vendor, workbookRow("Pending part", "P-100", "Test"));
      assert.equal(preview.status, 403);
      assert.equal(confirmed.status, 403);
      assert.equal((await database.collection("products").where("sellerId", "==", vendor.uid).get()).size, 0);
    });

    await t.test("Vendor A cannot update Vendor B's matching product", async () => {
      const vendorA = await createVendor();
      const vendorB = await createVendor();
      const foreignProduct = await database.collection("products").add({
        sellerId: vendorB.uid,
        sellerType: "vendor",
        partNumber: "SHARED-100",
        brand: "Acme",
        name: "Vendor B product",
        price: 100,
        status: "approved",
        enabled: true,
      });

      const response = await importFile(vendorA, workbookRow("Vendor A product", "SHARED-100", "Acme"));
      assert.equal(response.status, 201);
      const unchanged = await foreignProduct.get();
      assert.equal(unchanged.data().sellerId, vendorB.uid);
      assert.equal(unchanged.data().name, "Vendor B product");
      const vendorAProducts = await database.collection("products").where("sellerId", "==", vendorA.uid).get();
      assert.equal(vendorAProducts.size, 1);
      assert.equal(vendorAProducts.docs[0].data().name, "Vendor A product");
    });

    await t.test("updates preserve ownership and protected approval fields", async () => {
      const vendor = await createVendor();
      const existing = await database.collection("products").add({
        sellerId: vendor.uid,
        sellerType: "vendor",
        partNumber: "KEEP-100",
        brand: "Acme",
        name: "Old name",
        price: 100,
        status: "approved",
        enabled: true,
        approvedBy: "admin-test",
        createdAt: "2025-01-01T00:00:00.000Z",
      });
      const response = await importFile(vendor, workbookRow("New name", "KEEP-100", "Acme", "2750"));
      assert.equal(response.status, 201);
      const updated = (await existing.get()).data();
      assert.equal(updated.sellerId, vendor.uid);
      assert.equal(updated.sellerType, "vendor");
      assert.equal(updated.status, "approved");
      assert.equal(updated.enabled, true);
      assert.equal(updated.approvedBy, "admin-test");
      assert.equal(updated.createdAt, "2025-01-01T00:00:00.000Z");
      assert.equal(updated.name, "New name");
      assert.equal(updated.price, 2750);
    });

    await t.test("repeated submissions update one listing and retain one import job", async () => {
      const vendor = await createVendor();
      const workbook = workbookRow("Retry part", "RETRY-100", "Acme");
      const first = await importFile(vendor, workbook);
      const second = await importFile(vendor, workbook);
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      const [products, jobs] = await Promise.all([
        database.collection("products").where("sellerId", "==", vendor.uid).get(),
        database.collection("vendorImportJobs").where("vendorId", "==", vendor.uid).get(),
      ]);
      assert.equal(products.size, 1);
      assert.equal(jobs.size, 1);
      const [firstResult, secondResult] = await Promise.all([first.json(), second.json()]);
      assert.equal(firstResult.imported[0].id, secondResult.imported[0].id);
      assert.equal(firstResult.imported[0].updateExisting, false);
      assert.equal(secondResult.imported[0].updateExisting, true);
    });

    await t.test("concurrent imports create only one vendor-scoped listing", async () => {
      const vendor = await createVendor();
      const workbook = workbookRow("Concurrent part", "CONCURRENT-100", "Acme");
      const responses = await Promise.all([importFile(vendor, workbook), importFile(vendor, workbook)]);
      assert.deepEqual(responses.map((response) => response.status), [201, 201]);
      const products = await database.collection("products").where("sellerId", "==", vendor.uid).get();
      assert.equal(products.size, 1);
      assert.equal(products.docs[0].data().vendorImportKey, `${vendor.uid.toLowerCase()}|concurrent-100|acme`);
    });
  } finally {
    try {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    } finally {
      try {
        await deleteVendorData();
      } finally {
        await database.terminate();
      }
    }
  }
});
