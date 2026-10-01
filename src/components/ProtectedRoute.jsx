import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function ProtectedRoute({ children }) {
  const { currentUser, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-2">
        <div className="w-9 h-9 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-xs text-slate-500 font-mono tracking-wider uppercase">Authorizing Router...</span>
      </div>
    );
  }

  if (!currentUser) {
    // Retain target route configuration history inside location state parameters
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}