import { Navigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function VendorRoute({ children }) {
  const { currentUser, isAdmin, isVendor, loading } = useAuth();
  if (loading) return <div className="vendor-page vendor-loading">Checking vendor access...</div>;
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (!currentUser) return <Navigate to="/vendor/login" replace />;
  if (!isVendor) return <Navigate to="/profile" replace />;
  return children;
}