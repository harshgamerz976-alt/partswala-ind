import "dotenv/config";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { normalizeProduct } from "../../src/services/productCatalog.js";
import { publicProductCatalogIndexFields } from "../publicProductCatalogIndex.js";

const PAGE_SIZE = 200;
const MAX_BATCH_WRITES = 20;
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

function sameIndexFields(product, fields) {
  return Object.entries(fields).every(([key, value]) => JSON.stringify(product[key]) === JSON.stringify(value));
}

async function main() {
  const db = getDb();
  let cursor = null;
  let scanned = 0;
  let eligible = 0;
  let ineligible = 0;
  let changed = 0;
  let skipped = 0;
  let updated = 0;
  let errors = 0;
  let batch = db.batch();
  let batchWrites = 0;

  try {
    while (true) {
      let query = db.collection("products").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      scanned += page.size;

      const vendorIds = [...new Set(page.docs
        .map((snapshot) => normalizeProduct({ id: snapshot.id, ...snapshot.data() }))
        .filter((product) => product.sellerType.toLowerCase() === "vendor")
        .map((product) => product.sellerId)
        .filter(Boolean))];
      const vendorSnapshots = vendorIds.length
        ? await db.getAll(...vendorIds.map((vendorId) => db.collection("users").doc(vendorId)))
        : [];
      const vendorsById = new Map(vendorSnapshots.map((snapshot) => [
        snapshot.id,
        snapshot.exists ? snapshot.data() : null,
      ]));

      for (const snapshot of page.docs) {
        let fields;
        let product;
        try {
          product = snapshot.data();
          const normalizedProduct = normalizeProduct({ id: snapshot.id, ...product });
          const vendor = normalizedProduct.sellerType.toLowerCase() === "vendor"
            ? vendorsById.get(normalizedProduct.sellerId) || null
            : undefined;
          fields = publicProductCatalogIndexFields(snapshot.id, product, vendor);
          if (fields.catalogEligible) eligible += 1;
          else ineligible += 1;
          if (sameIndexFields(product, fields)) {
            skipped += 1;
            continue;
          }
          changed += 1;
          if (!APPLY) continue;
        } catch (error) {
          console.error(`Could not inspect product ${snapshot.id}: ${error.message}`);
          if (APPLY) throw error;
          errors += 1;
          continue;
        }

        if (APPLY) {
          batch.update(snapshot.ref, fields);
          batchWrites += 1;
          if (batchWrites === MAX_BATCH_WRITES) {
            await batch.commit();
            updated += batchWrites;
            batch = db.batch();
            batchWrites = 0;
          }
        }
      }

      cursor = page.docs.at(-1);
    }

    if (batchWrites) {
      await batch.commit();
      updated += batchWrites;
    }
  } catch (error) {
    errors += 1;
    console.error("Public product catalogue index migration scan failed:", error.message);
  }

  console.log(`Products scanned: ${scanned}`);
  console.log(`Eligible products: ${eligible}`);
  console.log(`Ineligible products: ${ineligible}`);
  console.log(`Products needing index updates: ${changed}`);
  console.log(`Already current / skipped: ${skipped}`);
  console.log(`Products updated: ${updated}`);
  console.log(`Errors: ${errors}`);
  if (errors) process.exitCode = 1;
  if (APPLY && !errors) console.log(`Indexed ${changed} product documents.`);
  if (!APPLY) console.log("Dry run only. Re-run with --apply to update Firestore.");
}

main().catch((error) => {
  console.error("Public product catalogue index migration failed:", error.message);
  process.exitCode = 1;
});
