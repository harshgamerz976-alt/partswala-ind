import { useState } from "react";
import { Check, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldAlert, User, Wrench } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function Register() {
  const { signup, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requirements = [
    [password.length >= 6, "6+ characters"],
    [/[A-Z]/.test(password), "One uppercase letter"],
    [/[0-9]/.test(password), "One number"],
  ];

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters long.");
      return;
    }
    setIsSubmitting(true);
    try {
      await signup(email, password, fullName);
      navigate("/");
    } catch (error) {
      setErrorMessage(error.code === "auth/email-already-in-use" ? "This email is already registered. Try signing in." : "We could not create your account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function getGoogleAuthError(error) {
    const messages = {
      "auth/popup-closed-by-user": "Google sign-up was cancelled.",
      "auth/popup-blocked": "The Google sign-up popup was blocked. Please allow popups and try again.",
      "auth/unauthorized-domain": "This domain is not allowed in Firebase Authentication. Add it to the authorized domains list.",
      "auth/configuration-not-found": "Google sign-in is not enabled in Firebase Authentication. Turn on Google sign-in in the Firebase console.",
      "auth/operation-not-allowed": "Google sign-in is disabled in Firebase Authentication. Enable it in the Firebase console.",
    };

    return messages[error?.code] || "Google sign-up was not completed. Please check your Firebase Google Auth setup.";
  }

  async function handleGoogleSignup() {
    setErrorMessage("");
    setIsSubmitting(true);
    try {
      await loginWithGoogle();
      navigate("/");
    } catch (error) {
      setErrorMessage(getGoogleAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-atmosphere" aria-hidden="true"><span /><span /><span /></div>
      <section className="auth-shell auth-register-shell">
        <div className="auth-brand"><span><Wrench size={18} /></span><strong>PARTSWALA <b>IND</b></strong></div>
        <div className="auth-intro"><p className="auth-kicker">JOIN THE DEPOT / 01</p><h1>Make the road easier.</h1><p>Create an account to move faster through every order.</p></div>
        {errorMessage && <div className="auth-error"><ShieldAlert size={16} /><span>{errorMessage}</span></div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <label>Full name<div className="auth-input-with-icon"><User size={16} /><input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" autoComplete="name" /></div></label>
          <label>Email address<div className="auth-input-with-icon"><Mail size={16} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></div></label>
          <label>Password<div className="auth-password"><LockKeyhole size={16} /><input required type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Create a password" autoComplete="new-password" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
          {password && <div className="auth-requirements">{requirements.map(([valid, label]) => <span className={valid ? "is-valid" : ""} key={label}><Check size={12} />{label}</span>)}</div>}
          <label>Confirm password<div className="auth-input-with-icon"><LockKeyhole size={16} /><input required type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" autoComplete="new-password" /></div></label>
          <button className="auth-submit" disabled={isSubmitting} type="submit">{isSubmitting ? <Loader2 className="auth-spinner" size={17} /> : "Create account"}</button>
        </form>
        <div className="auth-divider"><span>or</span></div><button type="button" onClick={handleGoogleSignup} disabled={isSubmitting} className="auth-google"><span>G</span> Continue with Google</button><p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p><Link to="/" className="auth-home">← Back to storefront</Link>
      </section>
    </main>
  );
}
