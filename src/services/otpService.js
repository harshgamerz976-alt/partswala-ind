import { doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";

export async function sendOTP(phone) {
  var code = String(Math.floor(100000 + Math.random() * 900000));
  await setDoc(doc(db, "otps", phone), {
    code: code,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  return code;
}

export async function verifyOTP(phone, enteredCode) {
  var snap = await getDoc(doc(db, "otps", phone));
  if (!snap.exists()) return { success: false, message: "No OTP found. Please request a new one." };

  var data = snap.data();
  var created = new Date(data.createdAt);
  var now = new Date();

  if ((now - created) > 5 * 60 * 1000) {
    await deleteDoc(doc(db, "otps", phone));
    return { success: false, message: "OTP expired. Request a new one." };
  }

  if (data.attempts >= 3) {
    await deleteDoc(doc(db, "otps", phone));
    return { success: false, message: "Too many attempts. Request a new OTP." };
  }

  await setDoc(doc(db, "otps", phone), { attempts: (data.attempts || 0) + 1 }, { merge: true });

  if (data.code === enteredCode) {
    await deleteDoc(doc(db, "otps", phone));
    return { success: true };
  }

  return { success: false, message: "Invalid OTP." };
}