import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase'; // Points directly to your existing firebase.js

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage('A secure password reset link has been sent to your inbox.');
      setEmail('');
    } catch (err) {
      switch (err.code) {
        case 'auth/user-not-found':
          setError('No user account discovered matching this email address.');
          break;
        case 'auth/invalid-email':
          setError('The provided email format is invalid.');
          break;
        default:
          setError('Failed to process password reset request. Please check connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 bg-[#020514]">
      <div className="max-w-md w-full bg-[#1e293b] p-8 rounded-xl border border-slate-700/60 shadow-xl space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-black text-white tracking-tight">PASSWORD RECOVERY</h2>
          <p className="text-xs text-slate-400 mt-1">Provide email details to authorize access link resets</p>
        </div>

        {error && (
          <div className="p-3 text-xs bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg">
            {error}
          </div>
        )}
        
        {message && (
          <div className="p-3 text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg">
            {message}
          </div>
        )}

        <form onSubmit={handleResetSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase mb-1.5">Registered Email</label>
            <input 
              type="email" 
              required 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              className="w-full h-10 px-3 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-[#f97316]" 
              placeholder="name@example.com" 
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading} 
            className="w-full h-10 font-semibold text-white bg-[#f97316] hover:bg-[#ea580c] rounded-lg transition-colors shadow-md mt-2"
          >
            {loading ? 'Processing Reset...' : 'Send Recovery Link'}
          </button>
        </form>

        <div className="text-center text-xs text-slate-400 pt-2 border-t border-slate-800">
          Remember credentials? <Link to="/login" className="text-[#f97316] font-semibold hover:underline">Return to Sign In</Link>
        </div>
      </div>
    </div>
  );
}