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
  const { getAuth } = await import("firebase-admin/auth");
  const database = getFirestore(getApp());
  const createdAccounts = [];
  const createdVendorIds = [];
  const createdProductIds = [];
  const createdImportJobIds = [];
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

  async function createCustomer(profileRole = "customer") {
    const email = `customer-${randomUUID()}@example.test`;
    const account = await emulatorRequest(
      authHost,
      "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "LocalEmulatorPass123!", returnSecureToken: true }),
      },
    );
    createdAccounts.push(account.idToken);
    createdVendorIds.push(account.localId);
    await database.collection("users").doc(account.localId).set({ role: profileRole });
    return { uid: account.localId, token: account.idToken };
  }

  async function createAdmin() {
    const email = `admin-${randomUUID()}@example.test`;
    const account = await emulatorRequest(
      authHost,
      `/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "LocalEmulatorPass123!", returnSecureToken: true }),
      },
    );
    createdVendorIds.push(account.localId);
    await getAuth(getApp()).setCustomUserClaims(account.localId, { admin: true });
    const signedIn = await emulatorRequest(
      authHost,
      `/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "LocalEmulatorPass123!", returnSecureToken: true }),
      },
    );
    createdAccounts.push(signedIn.idToken);
    return { uid: account.localId, token: signedIn.idToken };
  }

  async function seedImportJob(vendorId, fields = {}) {
    const reference = database.collection("vendorImportJobs").doc(`import-test-${randomUUID()}`);
    createdImportJobIds.push(reference.id);
    await reference.set({
      ...(vendorId === undefined ? {} : { vendorId }),
      createdAt: new Date().toISOString(),
      status: "completed",
      ...fields,
    });
    return reference.id;
  }

  async function listImportJobs(token) {
    const response = await fetch(`${api}/api/vendor/import-jobs`, {
      headers: token ? { Authorization: ["Bearer", token].join(" ") } : {},
    });
    return { status: response.status, body: await response.json() };
  }

  async function importFile(vendor, workbook, confirm = true, claimedVendorId = "", fileName = "vendor-import.xlsx") {
    const form = new FormData();
    form.append("file", new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
    if (confirm) form.append("confirm", "true");
    if (claimedVendorId) form.append("vendorId", claimedVendorId);
    const response = await fetch(`${api}/api/vendor/import-products`, {
      method: "POST",
      headers: { Authorization: `Bearer ${vendor.token}` },
      body: form,
    });
    if (response.ok) {
      const result = await response.clone().json();
      createdProductIds.push(...(result.imported || []).map(({ id }) => id));
    }
    return response;
  }

  async function importOversizedFile(token) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]), "oversized.xlsx");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return fetch(`${api}/api/vendor/import-products`, {
      method: "POST",
      headers,
      body: form,
    });
  }

  async function downloadTemplate(vendor) {
    return fetch(`${api}/api/vendor/import-template`, {
      headers: { Authorization: ["Bearer", vendor.token].join(" ") },
    });
  }

  const workbookRow = (name, partNumber, brand, price = "1250") => {
    return workbookRows([
      ["Part Number", "Brand", "Description", "MRP", "Selling Price", "Availability/Stock", "Compatible Vehicle"],
      [partNumber, brand, name, 1500, price, 5, "Volvo FM"],
    ]);
  };

  function workbookRows(rows) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Products");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }

  async function deleteVendorData() {
    const references = [
      ...new Set(createdProductIds).map((productId) => database.collection("products").doc(productId)),
      ...createdImportJobIds.map((jobId) => database.collection("vendorImportJobs").doc(jobId)),
    ];
    for (const uid of createdVendorIds) {
      const [products, jobs] = await Promise.all([
        database.collection("products").where("sellerId", "==", uid).get(),
        database.collection("vendorImportJobs").where("vendorId", "==", uid).get(),
      ]);
      references.push(...products.docs.map((snapshot) => snapshot.ref));
      references.push(...jobs.docs.map((snapshot) => snapshot.ref));
      references.push(database.collection("users").doc(uid));
    }
    const uniqueReferences = [...new Map(references.map((reference) => [reference.path, reference])).values()];
    for (let index = 0; index < uniqueReferences.length; index += 400) {
      const batch = database.batch();
      uniqueReferences.slice(index, index + 400).forEach((reference) => batch.delete(reference));
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
    await t.test("import-job listing enforces authentication, approved ownership, and verified admin access", async () => {
      const vendorA = await createVendor();
      const vendorB = await createVendor();
      const pendingVendor = await createVendor("pending");
      const customer = await createCustomer();
      const profileAdmin = await createCustomer("admin");
      const admin = await createAdmin();
      const vendorAJobId = await seedImportJob(vendorA.uid);
      const vendorBJobId = await seedImportJob(vendorB.uid);
      const orphanJobId = await seedImportJob(undefined);
      const malformedOwnerJobId = await seedImportJob(17);

      assert.equal((await listImportJobs()).status, 401);
      assert.equal((await listImportJobs(customer.token)).status, 403);
      assert.equal((await listImportJobs(profileAdmin.token)).status, 403);
      assert.equal((await listImportJobs(pendingVendor.token)).status, 403);

      const vendorAResult = await listImportJobs(vendorA.token);
      assert.equal(vendorAResult.status, 200);
      assert.deepEqual(vendorAResult.body.jobs.map(({ id }) => id), [vendorAJobId]);
      assert.equal(vendorAResult.body.jobs.every(({ vendorId }) => vendorId === vendorA.uid), true);
      assert.equal(vendorAResult.body.jobs.some(({ id }) => id === vendorBJobId), false);
      assert.equal(vendorAResult.body.jobs.some(({ id }) => id === orphanJobId), false);
      assert.equal(vendorAResult.body.jobs.some(({ id }) => id === malformedOwnerJobId), false);

      const vendorBResult = await listImportJobs(vendorB.token);
      assert.equal(vendorBResult.status, 200);
      assert.deepEqual(vendorBResult.body.jobs.map(({ id }) => id), [vendorBJobId]);

      const adminResult = await listImportJobs(admin.token);
      assert.equal(adminResult.status, 200);
      const adminJobIds = adminResult.body.jobs.map(({ id }) => id);
      assert.equal(adminJobIds.includes(vendorAJobId), true);
      assert.equal(adminJobIds.includes(vendorBJobId), true);
      assert.equal(adminJobIds.includes(orphanJobId), false);
      assert.equal(adminJobIds.includes(malformedOwnerJobId), false);
    });

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
      assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets.Products, { header: 1 })[0], [
        "Part Number", "Brand", "Description", "Selling Price", "MRP", "Availability / Stock", "Category", "Compatible Vehicle", "Quantity",
      ]);
    });

    await t.test("preview requires authentication and derives ownership from the token", async () => {
      const unauthenticated = await fetch(`${api}/api/vendor/import-products`, {
        method: "POST",
        body: new FormData(),
      });
      assert.equal(unauthenticated.status, 401);
      const oversizedUnauthenticated = await importOversizedFile();
      assert.equal(oversizedUnauthenticated.status, 401);

      const vendor = await createVendor();
      const malformed = await importFile(vendor, Buffer.from("not an Excel workbook"));
      assert.equal(malformed.status, 400);
      assert.match((await malformed.json()).message, /could not be read/i);

      const requiredHeaders = ["Part Number", "Brand", "Description", "Selling Price", "MRP", "Availability / Stock"];
      for (const missingHeader of requiredHeaders) {
        const headers = requiredHeaders.filter((header) => header !== missingHeader);
        const csv = `${headers.join(",")}\n${headers.map(() => "value").join(",")}\n`;
        const missingHeaderResponse = await importFile(
          vendor,
          Buffer.from(csv),
          false,
          "",
          `missing-${missingHeader.toLowerCase().replaceAll(" ", "-")}.csv`,
        );
        assert.equal(missingHeaderResponse.status, 400);
        assert.match((await missingHeaderResponse.json()).message, /missing required columns:/i);
      }

      const response = await importFile(vendor, workbookRow("Preview part", "PREVIEW-100", "Acme"), false, "forged-vendor-id");
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.importMode, "preview");
      assert.equal(result.rows[0].sellerId, vendor.uid);
      assert.notEqual(result.rows[0].sellerId, "forged-vendor-id");
      assert.equal(result.rows[0].name, "Preview part");
      assert.equal(result.rows[0].description, "Preview part");
      assert.equal(result.rows[0].mrp, 1500);
      assert.equal(result.rows[0].price, 1250);
      assert.deepEqual(result.requiredColumns, ["partNumber", "brand", "description", "price", "mrp", "stock"]);
      assert.equal((await database.collection("products").where("sellerId", "==", vendor.uid).get()).size, 0);
    });

    await t.test("unapproved vendors cannot preview or import", async () => {
      const vendor = await createVendor("pending");
      const preview = await importFile(vendor, workbookRow("Pending part", "P-100", "Test"), false);
      const confirmed = await importFile(vendor, workbookRow("Pending part", "P-100", "Test"));
      const oversized = await importOversizedFile(vendor.token);
      assert.equal(preview.status, 403);
      assert.equal(confirmed.status, 403);
      assert.equal(oversized.status, 403);
      assert.equal((await database.collection("products").where("sellerId", "==", vendor.uid).get()).size, 0);
    });

    await t.test("approved vendor bulk imports are rate-limited before file parsing", async () => {
      const vendor = await createVendor();
      const workbook = workbookRow("Rate limit preview", "RATE-LIMIT-100", "Acme");
      for (let index = 0; index < 20; index += 1) {
        const response = await importFile(vendor, workbook, false);
        assert.equal(response.status, 200);
      }

      const limited = await importOversizedFile(vendor.token);
      assert.equal(limited.status, 429);
      assert.match(limited.headers.get("retry-after"), /^\d+$/);
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

    await t.test("different product details create a separate listing without overwriting existing products", async () => {
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
      const unchanged = (await existing.get()).data();
      assert.equal(unchanged.sellerId, vendor.uid);
      assert.equal(unchanged.status, "approved");
      assert.equal(unchanged.enabled, true);
      assert.equal(unchanged.approvedBy, "admin-test");
      assert.equal(unchanged.createdAt, "2025-01-01T00:00:00.000Z");
      assert.equal(unchanged.name, "Old name");
      assert.equal(unchanged.price, 100);
      assert.equal(unchanged.description, undefined);
      assert.equal((await database.collection("products").where("sellerId", "==", vendor.uid).get()).size, 2);
    });

    await t.test("repeated submissions preserve existing listing data and retain one import job", async () => {
      const vendor = await createVendor();
      const workbook = workbookRow("Retry part", "RETRY-100", "Acme");
      const first = await importFile(vendor, workbook);
      assert.equal(first.status, 201);
      const firstResult = await first.json();
      const productReference = database.collection("products").doc(firstResult.imported[0].id);
      await productReference.update({ status: "approved", enabled: true, approvedBy: "admin-test" });
      const second = await importFile(vendor, workbook);
      assert.equal(second.status, 201);
      const secondResult = await second.json();
      const [products, jobs] = await Promise.all([
        database.collection("products").where("sellerId", "==", vendor.uid).get(),
        database.collection("vendorImportJobs").where("vendorId", "==", vendor.uid).get(),
      ]);
      assert.equal(products.size, 1);
      assert.equal(jobs.size, 1);
      assert.equal(firstResult.imported[0].id, secondResult.imported[0].id);
      assert.equal(firstResult.imported[0].alreadyExists, false);
      assert.equal(secondResult.imported[0].alreadyExists, true);
      const preserved = (await productReference.get()).data();
      assert.equal(preserved.status, "approved");
      assert.equal(preserved.enabled, true);
      assert.equal(preserved.approvedBy, "admin-test");
    });

    await t.test("identical rows import once while different descriptions create separate products", async () => {
      const vendor = await createVendor();
      const workbook = workbookRows([
        ["Part Number", "Brand", "Description", "MRP", "Selling Price", "Availability / Stock", "Quantity"],
        ["DUP-100", "Acme", "Same description", 1500, 1250, 5, 2],
        ["DUP-100", "Acme", "Same description", 1500, 1250, 5, 9],
        ["DUP-100", "Acme", "Different description", 1500, 1250, 5, 2],
      ]);
      const response = await importFile(vendor, workbook);
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.summary.validRows, 2);
      assert.equal(result.summary.duplicates, 1);
      const products = await database.collection("products").where("sellerId", "==", vendor.uid).get();
      assert.equal(products.size, 2);
      assert.deepEqual(products.docs.map((document) => document.data().description).sort(), ["Different description", "Same description"]);
      const sameDescription = products.docs.find((document) => document.data().description === "Same description").data();
      assert.equal(sameDescription.quantity, 2);
    });

    await t.test("concurrent imports create only one vendor-scoped listing", async () => {
      const vendor = await createVendor();
      const workbook = workbookRow("Concurrent part", "CONCURRENT-100", "Acme");
      const responses = await Promise.all([importFile(vendor, workbook), importFile(vendor, workbook)]);
      assert.deepEqual(responses.map((response) => response.status), [201, 201]);
      const products = await database.collection("products").where("sellerId", "==", vendor.uid).get();
      assert.equal(products.size, 1);
      const [identityVendorId, identityDigest] = products.docs[0].data().vendorImportKey.split("|");
      assert.equal(identityVendorId, vendor.uid);
      assert.match(identityDigest, /^[a-f0-9]{64}$/);
    });
    await t.test("selected approval is bounded and publishes only selected pending vendor products", async () => {
      const vendor = await createVendor();
      const admin = await createAdmin();
      const pendingProduct = database.collection("products").doc(`approval-${randomUUID()}`);
      const pendingNonVendorProduct = database.collection("products").doc(`approval-non-vendor-${randomUUID()}`);
      createdProductIds.push(pendingProduct.id, pendingNonVendorProduct.id);
      await Promise.all([
        pendingProduct.set({ name: "Approval test part", partNumber: "APPROVAL-1", brand: "Acme", sellerId: vendor.uid, sellerType: "vendor", enabled: false, status: "pending" }),
        pendingNonVendorProduct.set({ name: "Store pending part", sellerId: "partswala", sellerType: "partswala", enabled: false, status: "pending" }),
        database.collection("users").doc(vendor.uid).set({ role: "vendor", vendorStatus: "approved", vendorProfile: { businessName: "Approval Test Business" } }),
      ]);
      const unauthorizedListResponse = await fetch(`${api}/api/admin/products/pending-vendor`);
      assert.equal(unauthorizedListResponse.status, 401);

      const vendorListResponse = await fetch(`${api}/api/admin/products/pending-vendor`, {
        headers: { Authorization: ["Bearer", vendor.token].join(" ") },
      });
      assert.equal(vendorListResponse.status, 403);

      const listResponse = await fetch(`${api}/api/admin/products/pending-vendor`, {
        headers: { Authorization: ["Bearer", admin.token].join(" ") },
      });
      assert.equal(listResponse.status, 200);
      const pendingList = await listResponse.json();
      const listedProduct = pendingList.products.find((product) => product.id === pendingProduct.id);
      assert.equal(listedProduct.businessName, "Approval Test Business");
      assert.equal(pendingList.products.some((product) => product.id === pendingNonVendorProduct.id), false);

      const invalidCountResponse = await fetch(`${api}/api/admin/products/approve-selected`, {
        method: "POST",
        headers: { Authorization: ["Bearer", admin.token].join(" "), "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: Array.from({ length: 51 }, (_, index) => `product-${index}`) }),
      });
      assert.equal(invalidCountResponse.status, 400);

      const vendorDeniedResponse = await fetch(`${api}/api/admin/products/approve-selected`, {
        method: "POST",
        headers: { Authorization: ["Bearer", vendor.token].join(" "), "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [pendingProduct.id] }),
      });
      assert.equal(vendorDeniedResponse.status, 403);

      const response = await fetch(`${api}/api/admin/products/approve-selected`, {
        method: "POST",
        headers: { Authorization: ["Bearer", admin.token].join(" "), "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [pendingProduct.id] }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.approved.length, 1);
      const approvedSnapshot = await database.collection("products").doc(result.approved[0].product.id).get();
      assert.equal(approvedSnapshot.data().sellerType, "vendor");
      assert.equal(approvedSnapshot.data().status, "Available");
      assert.equal(approvedSnapshot.data().enabled, true);
      assert.equal(approvedSnapshot.data().vendorName, "Approval Test Business");
      assert.equal(approvedSnapshot.data().vendorBusinessName, "Approval Test Business");
      assert.equal((await pendingNonVendorProduct.get()).data().status, "pending");

      const unauthenticatedResponse = await fetch(`${api}/api/admin/products/approve-selected`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [pendingProduct.id] }),
      });
      assert.equal(unauthenticatedResponse.status, 401);
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
