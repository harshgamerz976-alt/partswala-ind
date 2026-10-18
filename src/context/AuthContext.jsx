import { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  RecaptchaVerifier,
  linkWithPhoneNumber,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, getDocFromServer, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useToast } from "./useToast";
import { AuthContext } from "./useAuth";
import { registerVerifiedPhone, stripProtectedProfileFields } from "../services/phoneVerificationService";
import { formatIndianPhoneForFirebase } from "../../shared/phoneNumber.js";
import { hasAdminClaim } from "../../backend/adminAuthorization.js";

function normalizePhoneForFirebase(phoneNumber) {
  return formatIndianPhoneForFirebase(phoneNumber);
}

export const AuthProvider = ({ children }) => {
  const { addToast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [phoneConfirmation, setPhoneConfirmation] = useState(null);
  const profileListenerRef = useRef(null);
  const profileSyncVersionRef = useRef(0);
  const profileRefreshVersionRef = useRef(0);

  const refreshUserProfile = useCallback(async (targetUser = auth.currentUser) => {
    if (!targetUser) {
      setUserProfile(null);
      return null;
    }
    const version = ++profileRefreshVersionRef.current;
    const snapshot = await getDocFromServer(doc(db, "users", targetUser.uid));
    const profile = snapshot.exists() ? snapshot.data() : null;
    if (version === profileRefreshVersionRef.current && auth.currentUser?.uid === targetUser.uid) setUserProfile(profile);
    return profile;
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const version = ++profileSyncVersionRef.current;
      profileListenerRef.current?.();
      profileListenerRef.current = null;
      setLoading(true);
      setCurrentUser(user);
      if (!user) {
        setUserProfile(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      try {
        const token = await user.getIdTokenResult();
        if (version !== profileSyncVersionRef.current) return;
        setIsAdmin(hasAdminClaim({
          admin: token.claims.admin === true,
          email: token.claims.email || user.email,
          email_verified: token.claims.email_verified === true,
        }));
        profileListenerRef.current = onSnapshot(doc(db, "users", user.uid), (snapshot) => {
          if (version !== profileSyncVersionRef.current || auth.currentUser?.uid !== user.uid) return;
          setUserProfile(snapshot.exists() ? snapshot.data() : null);
          setLoading(false);
        }, (error) => {
          console.warn("Could not watch the user profile.", error.message);
          if (version === profileSyncVersionRef.current) {
            setUserProfile(null);
            setLoading(false);
          }
        });
      } catch (error) {
        console.warn("Could not load the user profile.", error.message);
        if (version === profileSyncVersionRef.current) {
          setIsAdmin(false);
          setUserProfile(null);
          setLoading(false);
        }
      }
    });

    return () => {
      profileSyncVersionRef.current += 1;
      unsubscribe();
      profileListenerRef.current?.();
      profileListenerRef.current = null;
    };
  }, []);

  async function ensureProfile(user, profile = {}) {
    let existingProfile = {};
    try {
      const snapshot = await getDoc(doc(db, "users", user.uid));
      if (snapshot.exists()) existingProfile = snapshot.data();
    } catch (error) {
      console.warn("Could not read the existing user profile.", error?.message || error);
    }
    const nextProfile = {
      displayName: profile.displayName ?? user.displayName ?? "",
      email: user.email || "",
      photoURL: user.photoURL || profile.photoURL || "",
      phone: profile.phone ?? existingProfile.phone ?? "",
      role: existingProfile.role || "customer",
      createdAt: existingProfile.createdAt || new Date().toISOString(),
      ...profile,
    };
    const safeProfile = stripProtectedProfileFields(nextProfile);

    try {
      await setDoc(doc(db, "users", user.uid), safeProfile, { merge: true });
    } catch (error) {
      console.warn("Profile sync skipped for this user.", error?.message || error);
    }

    setUserProfile((previous) => ({ ...(previous || {}), ...safeProfile }));
    return safeProfile;
  }

  async function login(email, password) {
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    await ensureProfile(credential.user);
    return credential.user;
  }

  async function signup(email, password, displayName) {
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (displayName) await updateProfile(credential.user, { displayName });
    await ensureProfile(credential.user, { displayName: displayName || "" });
    return credential.user;
  }

  async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const credential = await signInWithPopup(auth, provider);
    await ensureProfile(credential.user);
    return credential.user;
  }

  async function logout() {
    await signOut(auth);
  }

  async function updateUserProfileData(data) {
    if (!currentUser) throw new Error("Login required");
    // Phone verification fields are server-owned; strip them so a local save can never spoof them.
    const safeData = stripProtectedProfileFields(data);
    await setDoc(doc(db, "users", currentUser.uid), safeData, { merge: true });
    setUserProfile((previous) => ({ ...previous, ...safeData }));
    if (data.displayName && data.displayName !== currentUser.displayName) {
      await updateProfile(currentUser, { displayName: data.displayName });
    }
  }

  async function sendPhoneOtp(phoneNumber) {
    const signedInUser = auth.currentUser;
    if (!signedInUser) throw new Error("Please sign in before verifying a phone number.");

    const expectedPhoneNumber = normalizePhoneForFirebase(phoneNumber);
    if (!expectedPhoneNumber) throw new Error("Enter a valid 10-digit Indian mobile number.");
    const existingPhoneNumber = normalizePhoneForFirebase(signedInUser.phoneNumber || "");

    if (existingPhoneNumber && existingPhoneNumber === expectedPhoneNumber) {
      setPhoneConfirmation({ confirmation: null, verifier: null, alreadyLinked: true, phoneNumber: expectedPhoneNumber });
      return;
    }

    const recaptchaElement = document.getElementById("phone-recaptcha");
    if (!recaptchaElement) throw new Error("Phone verification is not ready yet.");

    const verifier = new RecaptchaVerifier(auth, recaptchaElement, { size: "invisible" });

    try {
      const confirmation = await linkWithPhoneNumber(signedInUser, expectedPhoneNumber, verifier);
      setPhoneConfirmation({ confirmation, verifier, alreadyLinked: false, phoneNumber: expectedPhoneNumber });
    } catch (error) {
      if (error?.code === "auth/provider-already-linked") {
        verifier.clear();
        setPhoneConfirmation({ confirmation: null, verifier: null, alreadyLinked: true, phoneNumber: expectedPhoneNumber });
        return;
      }
      verifier.clear();
      throw error;
    }
  }

  async function verifyPhoneOtp(code, phoneNumber) {
    const expectedPhoneNumber = normalizePhoneForFirebase(phoneNumber);
    if (!expectedPhoneNumber) throw new Error("Enter a valid 10-digit Indian mobile number.");
    const existingPhoneNumber = normalizePhoneForFirebase(auth.currentUser?.phoneNumber || "");

    if (phoneConfirmation?.alreadyLinked || (existingPhoneNumber && existingPhoneNumber === expectedPhoneNumber)) {
      await confirmVerifiedPhone(expectedPhoneNumber);
      if (phoneConfirmation?.verifier) {
        phoneConfirmation.verifier.clear();
      }
      setPhoneConfirmation(null);
      return;
    }

    if (!phoneConfirmation || !phoneConfirmation.confirmation) throw new Error("Request a verification code first.");
    await phoneConfirmation.confirmation.confirm(code);
    await confirmVerifiedPhone(expectedPhoneNumber);
    phoneConfirmation.verifier?.clear();
    setPhoneConfirmation(null);
  }

  /**
   * Firebase Phone Auth proved ownership of the number; the backend records the verified state
   * because the browser is not allowed to write phoneVerified.
   */
  async function confirmVerifiedPhone(expectedPhoneNumber) {
    await registerVerifiedPhone(expectedPhoneNumber);
    await auth.currentUser?.reload();
    setCurrentUser(auth.currentUser);
    const profile = await refreshUserProfile();
    if (profile?.phoneVerified !== true || normalizePhoneForFirebase(profile.verifiedPhone) !== expectedPhoneNumber) {
      throw new Error("Your verified number was saved, but checkout could not refresh its verification status. Please reopen checkout.");
    }
  }

  async function changeUserPassword(password) {
    if (!currentUser) throw new Error("Login required");
    await updatePassword(currentUser, password);
    addToast("Password updated successfully", "success");
  }

  async function deleteAccount() {
    if (!currentUser) return;
    await deleteUser(currentUser);
    setUserProfile(null);
  }

  const value = {
    currentUser,
    user: currentUser,
    userProfile,
    isAdmin,
    role: isAdmin ? "admin" : userProfile?.role || "customer",
    isVendor: !isAdmin && userProfile?.role === "vendor" && userProfile?.vendorStatus === "approved",
    loading,
    login,
    signup,
    loginWithGoogle,
    logout,
    updateUserProfileData,
    refreshUserProfile,
    changeUserPassword,
    deleteAccount,
    showToast: addToast,
    sendPhoneOtp,
    verifyPhoneOtp,
  };

  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
};
