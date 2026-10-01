import "dotenv/config";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, FieldValue } from "firebase-admin/firestore";

const PAGE_SIZE = 200;
const APPLY = process.argv.includes("--apply");

function getDb() {
  const required = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing server environment variables: ${missing.join(", ")}`);
  const app = getApps()[0] || initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
  return getFirestore(app);
}

async function main() {
  const db = getDb();
  const fields = ["vendorAddress", "vendorGstin", "vendorState"];
  let cursor = null;
  let scanned = 0;
  let matched = 0;
  let batch = db.batch();
  let batchWrites = 0;

  while (true) {
    let query = db.collection("products").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    scanned += page.size;
    for (const snapshot of page.docs) {
      const data = snapshot.data();
      const privateFields = fields.filter((field) => Object.hasOwn(data, field));
      if (!privateFields.length) continue;
      matched += 1;
      if (!APPLY) continue;
      batch.update(snapshot.ref, Object.fromEntries(privateFields.map((field) => [field, FieldValue.delete()])));
      batchWrites += 1;
      if (batchWrites === 450) {
        await batch.commit();
        batch = db.batch();
        batchWrites = 0;
      }
    }
    cursor = page.docs.at(-1);
  }

  if (batchWrites) await batch.commit();
  console.log(`${APPLY ? "Removed private fields from" : "Would remove private fields from"} ${matched} product documents; scanned ${scanned}.`);
  if (!APPLY) console.log("Dry run only. Re-run with --apply to update Firestore.");
}

main().catch((error) => {
  console.error("Vendor product privacy migration failed:", error.message);
  process.exitCode = 1;
});