import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function NotFound() {
  const navigate = useNavigate();
  useEffect(() => { const timer = setTimeout(() => navigate("/"), 5000); return () => clearTimeout(timer); }, [navigate]);

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center text-center fade-in">
      <p className="text-8xl mb-6">🛑</p>
      <h1 className="text-6xl font-extrabold text-white mb-4">404</h1>
      <h2 className="text-2xl text-gray-400 mb-2">Page Not Found</h2>
      <p className="text-gray-500 mb-8">Taking you back to safety in <span className="text-orange-500 font-bold">5 seconds</span>...</p>
      <button onClick={() => navigate("/")} className="px-8 py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 transition-colors hover-fast">Go Home Now</button>
    </div>
  );
}