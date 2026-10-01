import { useState } from "react";
import { useAuth } from "../context/useAuth";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export default function Signup() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const { signup, showToast } = useAuth();
  const navigate = useNavigate();

  const getPasswordStrength = (pass) => {
    let score = 0;
    if (pass.length >= 6) score++;
    if (pass.length >= 10) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    return score;
  };

  const strength = getPasswordStrength(password);

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);

    try {
      await signup(email, password, fullName);
      showToast("Account created successfully!");
      navigate("/");
    } catch (err) {
      if (err.code === "auth/email-already-in-use") {
        setError("This email is already registered. Please log in or reset your password.");
      } else {
        setError("Failed to create an account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-2">Create Account</h2>
        <p className="text-slate-400 text-sm mb-6">Join us to manage orders and fast checkout</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-slate-400 text-xs font-semibold mb-1 uppercase tracking-wider">
              Full Name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="John Doe"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-semibold mb-1 uppercase tracking-wider">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-semibold mb-1 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Password Strength Meter */}
            {password && (
              <div className="mt-2">
                <div className="flex gap-1 h-1">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <div
                      key={level}
                      className={`h-full flex-1 rounded-full transition-all duration-300 ${
                        strength >= level
                          ? strength <= 2
                            ? "bg-red-500"
                            : strength <= 3
                            ? "bg-yellow-500"
                            : "bg-emerald-500"
                          : "bg-slate-800"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block font-mono">
                  {strength <= 2 ? "Weak" : strength <= 3 ? "Medium" : "Strong"} Password
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-semibold mb-1 uppercase tracking-wider">
              Confirm Password
            </label>
            <input
              type={showPassword ? "text" : "password"}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-500 text-white font-medium text-sm rounded-lg py-3 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign Up"}
          </button>
        </form>

        <p className="text-center text-xs text-slate-500 mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-orange-400 font-semibold hover:underline">
            Log In
          </Link>
        </p>
      </div>
    </div>
  );
}