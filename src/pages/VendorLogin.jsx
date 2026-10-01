import { useEffect, useState } from "react";
import { createUserWithEmailAndPassword, deleteUser, linkWithPhoneNumber, RecaptchaVerifier, signOut, updateProfile } from "firebase/auth";
import { doc, getDoc, writeBatch } from "firebase/firestore";
import { ArrowLeft, Loader2, Store } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { auth, db } from "../firebase";

const EMPTY_APPLICATION = {
  businessName: "",
  ownerName: "",
  email: "",
  phone: "",
  businessAddress: "",
  city: "",
  state: "",
  pincode: "",
  gstin: "",
  pan: "",
};

function normalizeIndianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return "";
}

export default function VendorLogin() {
  const { currentUser, userProfile, isAdmin, loading: authLoading, login, logout } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [application, setApplication] = useState(EMPTY_APPLICATION);
  const [password, setPassword] = useState("");
  const [vendorApplication, setVendorApplication] = useState(null);
  const [phoneConfirmation, setPhoneConfirmation] = useState(null);
  const [phoneVerifier, setPhoneVerifier] = useState(null);
  const [applicationUserCreated, setApplicationUserCreated] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (!currentUser || authLoading) return;
    if (isAdmin) {
      navigate("/admin", { replace: true });
      return;
    }
    if (userProfile?.role === "vendor" && userProfile.vendorStatus === "approved") {
      navigate("/vendor/dashboard", { replace: true });
      return;
    }
    getDoc(doc(db, "vendorApplications", currentUser.uid))
      .then((snapshot) => setVendorApplication(snapshot.exists() ? snapshot.data() : null))
      .catch(() => setError("Your vendor application status could not be loaded."));
  }, [currentUser, authLoading, userProfile, isAdmin, navigate]);

  function updateApplication(event) {
    setApplication((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const signedInUser = await login(application.email, password);
      const token = await signedInUser.getIdTokenResult(true);
      if (token.claims.admin === true) {
        navigate("/admin", { replace: true });
        return;
      }

      const [profileSnapshot, vendorSnapshot] = await Promise.all([
        getDoc(doc(db, "users", signedInUser.uid)),
        getDoc(doc(db, "vendorApplications", signedInUser.uid)),
      ]);
      const profile = profileSnapshot.exists() ? profileSnapshot.data() : {};
      if (profile.role === "vendor" && profile.vendorStatus === "approved") {
        navigate("/vendor/dashboard", { replace: true });
      } else if (vendorSnapshot.exists()) {
        setVendorApplication(vendorSnapshot.data());
      } else {
        navigate("/", { replace: true });
      }
    } catch (loginError) {
      setError(loginError.message || "We could not sign you in. Check the email and password, or submit a vendor application.");
    } finally {
      setLoading(false);
    }
  }

  async function saveVendorApplication(user, phoneNumber) {
    await user.getIdToken(true);
    const email = String(user.email || application.email).trim().toLowerCase();
    const applicationRef = doc(db, "vendorApplications", user.uid);
    const existing = await getDoc(applicationRef);
    if (existing.exists()) {
      setVendorApplication(existing.data());
      throw new Error("VENDOR_APPLICATION_EXISTS");
    }
    const timestamp = new Date().toISOString();
    const batch = writeBatch(db);
    // The verified-phone state is written only by the backend after Firebase Phone Auth confirms
    // the number, so the browser never sets phoneVerified here.
    batch.set(doc(db, "users", user.uid), {
      email,
      displayName: application.ownerName.trim(),
      role: "customer",
      phone: phoneNumber,
      createdAt: timestamp,
    }, { merge: true });
    batch.set(applicationRef, {
      businessName: application.businessName.trim(),
      ownerName: application.ownerName.trim(),
      email,
      phone: phoneNumber,
      businessAddress: application.businessAddress.trim(),
      city: application.city.trim(),
      state: application.state.trim(),
      pincode: application.pincode.trim(),
      gstin: application.gstin.trim().toUpperCase(),
      pan: application.pan.trim().toUpperCase(),
      vendorId: user.uid,
      status: "pending",
      submittedAt: timestamp,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: "",
    });
    await batch.commit();
    setApplicationUserCreated(false);
    setVendorApplication({ businessName: application.businessName, status: "pending", submittedAt: timestamp });
    setApplication(EMPTY_APPLICATION);
  }

  async function handleApplication(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    let vendorUser = currentUser;
    let newlyCreatedUser = null;

    try {
      const phoneNumber = normalizeIndianPhone(application.phone);
      if (!phoneNumber) throw new Error("Enter a valid 10-digit Indian mobile number.");

      if (phoneConfirmation) {
        const credential = await phoneConfirmation.confirm(verificationCode.trim());
        const verifiedPhone = normalizeIndianPhone(credential.user.phoneNumber || application.phone);
        phoneVerifier?.clear();
        setPhoneConfirmation(null);
        setPhoneVerifier(null);
        await saveVendorApplication(credential.user, verifiedPhone);
        return;
      }

      if (!vendorUser) {
        const email = application.email.trim().toLowerCase();
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        vendorUser = credential.user;
        newlyCreatedUser = vendorUser;
        setApplicationUserCreated(true);
        await updateProfile(vendorUser, { displayName: application.ownerName.trim() });
      }

      if (normalizeIndianPhone(vendorUser.phoneNumber) === phoneNumber) {
        await saveVendorApplication(vendorUser, phoneNumber);
        return;
      }

      const recaptchaElement = document.getElementById("vendor-phone-recaptcha");
      if (!recaptchaElement) throw new Error("Phone verification is not ready. Refresh and try again.");
      const verifier = new RecaptchaVerifier(auth, recaptchaElement, { size: "invisible" });
      try {
        const confirmation = await linkWithPhoneNumber(vendorUser, phoneNumber, verifier);
        setPhoneConfirmation(confirmation);
        setPhoneVerifier(verifier);
        setInfo("A verification code was sent to your mobile number.");
      } catch (phoneError) {
        verifier.clear();
        throw phoneError;
      }
    } catch (submitError) {
      const messages = {
        "auth/email-already-in-use": "An account already exists for this email. Sign in to continue.",
        "auth/account-exists-with-different-credential": "This phone number is already linked to another account. Sign in to that account and apply there, or use a different phone number. You do not need to be signed in to see this error.",
        "auth/credential-already-in-use": "This phone number is already linked to another account. Sign in to that account and apply there, or use a different phone number.",
        "auth/invalid-phone-number": "Enter a valid mobile number with its country code.",
        "auth/too-many-requests": "Too many verification attempts. Wait a while and try again.",
        "auth/operation-not-allowed": "Phone verification is not enabled in Firebase Authentication. Contact support.",
        "auth/code-expired": "That verification code expired. Request a new code.",
        "auth/invalid-verification-code": "That verification code is incorrect. Check it and try again.",
      };
      const retryablePhoneError = ["auth/invalid-verification-code", "auth/code-expired", "auth/too-many-requests"].includes(submitError.code);
      if ((newlyCreatedUser || applicationUserCreated) && !retryablePhoneError) {
        const incompleteUser = newlyCreatedUser || auth.currentUser;
        try {
          if (incompleteUser) await deleteUser(incompleteUser);
        } catch (cleanupError) {
          console.warn("Could not remove the incomplete vendor account.", cleanupError);
        }
        await signOut(auth);
        setApplicationUserCreated(false);
        phoneVerifier?.clear();
        setPhoneVerifier(null);
        setPhoneConfirmation(null);
        setVerificationCode("");
      }
      setError(submitError.message === "VENDOR_APPLICATION_EXISTS"
        ? "A vendor application already exists for this account. Its current status is shown here."
        : submitError.code === "auth/billing-not-enabled"
          ? "Phone verification requires Firebase billing to be enabled. No vendor application was submitted, and the new account has been signed out."
          : messages[submitError.code] || submitError.message || "The vendor application could not be submitted. Check your details and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (currentUser && !authLoading && vendorApplication) {
    const rejected = vendorApplication.status === "rejected";
    return <main className="vendor-page"><section className="vendor-auth-shell"><Link to="/" className="vendor-back"><ArrowLeft size={15} /> Storefront</Link><div className="vendor-brand"><Store size={20} /><span>PARTSWALA VENDOR</span></div><p className="vendor-kicker">APPLICATION STATUS</p><h1>{rejected ? "Application needs changes." : "Application under review."}</h1><p className="vendor-status-copy">Status: <strong>{rejected ? "Rejected" : "Pending review"}</strong></p>{vendorApplication.rejectionReason && <div className="vendor-rejection"><strong>Reason</strong><p>{vendorApplication.rejectionReason}</p></div>}<button className="vendor-secondary" type="button" onClick={logout}>Sign out</button></section></main>;
  }

  return <main className="vendor-page"><section className="vendor-auth-shell">
    <Link to="/" className="vendor-back"><ArrowLeft size={15} /> Storefront</Link>
    <div className="vendor-brand"><Store size={20} /><span>PARTSWALA VENDOR</span></div>
    <p className="vendor-kicker">{mode === "login" ? "VENDOR ACCESS / 01" : "VENDOR APPLICATION / 01"}</p>
    <h1>{mode === "login" ? "Vendor sign in." : "Apply as a vendor."}</h1>
    <p className="vendor-intro">{mode === "login" ? "Sign in to manage your product submissions." : "Applications are reviewed by PARTSWALA before vendor access is enabled."}</p>
    {error && <p className="vendor-error" role="alert">{error}</p>}
    {mode === "login" ? <form className="vendor-form" onSubmit={handleLogin}>
      <label>Email<input required type="email" autoComplete="email" value={application.email} onChange={(event) => setApplication((previous) => ({ ...previous, email: event.target.value }))} /></label>
      <label>Password<input required minLength="6" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="vendor-primary" disabled={loading}>{loading ? <Loader2 size={16} /> : null} Sign in</button>
    </form> : <form className="vendor-form" onSubmit={handleApplication}>
      <label>Business name<input required name="businessName" value={application.businessName} onChange={updateApplication} /></label>
      <label>Owner / contact person<input required name="ownerName" value={application.ownerName} onChange={updateApplication} /></label>
      {currentUser ? <p className="vendor-account-note">Using your signed-in account email for this application.</p> : <label>Email<input required type="email" name="email" autoComplete="email" placeholder="business@example.com" value={application.email} onChange={updateApplication} /></label>}
      {!currentUser && <label>Password<input required minLength="6" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
      <label>Phone<input required type="tel" name="phone" value={application.phone} onChange={updateApplication} disabled={Boolean(phoneConfirmation)} placeholder="10-digit mobile number" /></label>
      <div id="vendor-phone-recaptcha" className="phone-recaptcha" />
      {phoneConfirmation && <label>SMS verification code<input required inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" /></label>}
      <label>Business address<input required name="businessAddress" value={application.businessAddress} onChange={updateApplication} /></label>
      <div className="vendor-two-fields"><label>City<input required name="city" value={application.city} onChange={updateApplication} /></label><label>State<input required name="state" value={application.state} onChange={updateApplication} /></label></div>
      <label>PIN code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" name="pincode" value={application.pincode} onChange={updateApplication} /></label>
      <label>GSTIN <span>Optional</span><input name="gstin" value={application.gstin} onChange={updateApplication} /></label>
      <label>PAN <span>Optional</span><input name="pan" value={application.pan} onChange={updateApplication} /></label>
      {info && <p className="vendor-success" role="status">{info}</p>}
      <button className="vendor-primary" disabled={loading || Boolean(phoneConfirmation && verificationCode.length < 6)}>{loading ? <Loader2 size={16} /> : null}{phoneConfirmation ? "Verify phone & submit" : "Verify phone number"}</button>
    </form>}
    <p className="vendor-switch">{mode === "login" ? "New vendor?" : "Already applied or have an account?"} <button type="button" onClick={() => { setMode(mode === "login" ? "apply" : "login"); setError(""); setInfo(""); }}>{mode === "login" ? "Apply here" : "Sign in"}</button></p>
  </section></main>;
}