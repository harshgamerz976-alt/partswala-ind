import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, Loader2, Mail, ShieldAlert, Wrench } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminLogin = location.pathname.includes("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function getAuthError(error) {
    const messages = {
      "auth/invalid-credential": "The email or password is incorrect.",
      "auth/user-not-found": "The email or password is incorrect.",
      "auth/wrong-password": "The email or password is incorrect.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/too-many-requests": "Too many attempts. Please try again later.",
    };
    return messages[error.code] || "We could not sign you in. Please try again.";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate(isAdminLogin ? "/admin" : "/");
    } catch (error) {
      setErrorMessage(getAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function getGoogleAuthError(error) {
    const messages = {
      "auth/popup-closed-by-user": "Google sign-in was cancelled.",
      "auth/popup-blocked": "The Google sign-in popup was blocked. Please allow popups and try again.",
      "auth/unauthorized-domain": "This domain is not allowed in Firebase Authentication. Add it to the authorized domains list.",
      "auth/configuration-not-found": "Google sign-in is not enabled in Firebase Authentication. Turn on Google sign-in in the Firebase console.",
      "auth/operation-not-allowed": "Google sign-in is disabled in Firebase Authentication. Enable it in the Firebase console.",
    };

    return messages[error?.code] || "Google sign-in was not completed. Please check your Firebase Google Auth setup.";
  }

  async function handleGoogleLogin() {
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
      <section className="auth-shell">
        <div className="auth-brand"><span><Wrench size={18} /></span><strong>PARTSWALA <b>IND</b></strong></div>
        <div className="auth-intro"><p className="auth-kicker">{isAdminLogin ? "CONTROL ACCESS / 01" : "DRIVER ACCESS / 01"}</p><h1>{isAdminLogin ? "Admin portal." : "Welcome back."}</h1><p>{isAdminLogin ? "Sign in to manage the parts operation." : "Your next component is waiting."}</p></div>
        {errorMessage && <div className="auth-error"><ShieldAlert size={16} /><span>{errorMessage}</span></div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
          <label>Password<div className="auth-password"><LockKeyhole size={16} /><input required minLength={6} type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
          <button className="auth-submit" disabled={isSubmitting} type="submit">{isSubmitting ? <Loader2 className="auth-spinner" size={17} /> : <><Mail size={16} /> Sign in</>}</button>
        </form>
        {!isAdminLogin && <><div className="auth-divider"><span>or continue with</span></div><button type="button" onClick={handleGoogleLogin} disabled={isSubmitting} className="auth-google"><span>G</span> Continue with Google</button><p className="auth-switch">New to PartsWala? <Link to="/register">Create an account</Link></p></>}
        {!isAdminLogin && <p className="auth-switch">Selling parts? <Link to="/vendor/login">Vendor portal</Link></p>}
        <Link to="/" className="auth-home">← Back to storefront</Link>
      </section>
    </main>
  );
}
