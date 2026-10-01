import "dotenv/config";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

async function main() {
  const [email, action] = process.argv.slice(2);
  if (!email || !["grant", "revoke"].includes(action)) {
    throw new Error("Usage: node scripts/setAdminClaim.js <verified-account-email> <grant|revoke>");
  }
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
  const auth = getAuth(app);
  const user = await auth.getUserByEmail(email.trim());
  if (!user.emailVerified) throw new Error("Admin claims can only be assigned to an email-verified account.");
  const claims = { ...(user.customClaims || {}) };
  if (action === "grant") claims.admin = true;
  else delete claims.admin;
  await auth.setCustomUserClaims(user.uid, claims);
  await auth.revokeRefreshTokens(user.uid);
  console.log(`Admin claim ${action}ed for Firebase UID ${user.uid}. The user must sign in again.`);
}

main().catch((error) => {
  console.error("Admin claim update failed:", error.message);
  process.exitCode = 1;
});