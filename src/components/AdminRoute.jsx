import { Navigate } from 'react-router-dom';
import { useAuth } from "../context/useAuth";

export default function AdminRoute({ children }) {
  const { currentUser, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020514] flex flex-col items-center justify-center text-white font-sans">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#f97316] mb-4"></div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
          Securing Connection...
        </p>
      </div>
    );
  }

  if (currentUser && isAdmin) {
    return children;
  }

  // Anonymous users get the dedicated admin sign-in screen; signed-in non-admins go home.
  return <Navigate to={currentUser ? "/" : "/admin/login"} replace />;
}