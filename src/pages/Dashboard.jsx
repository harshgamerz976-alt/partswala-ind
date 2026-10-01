import { useState, useEffect } from "react";
import { useAuth } from "../context/useAuth";
import { getUserOrders } from "../services/orderService";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [userOrders, setUserOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      navigate("/login");
      return;
    }

    async function fetchUserHistory() {
      try {
        const orders = await getUserOrders();
        
        // Sort manually by date since composite index requirements can vary
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setUserOrders(orders);
      } catch (err) {
        console.error("History engine lookups failed.", err);
      } finally {
        setLoading(false);
      }
    }

    fetchUserHistory();
  }, [currentUser, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-8 py-12 fade-in">
      <div className="max-w-4xl mx-auto">
        {/* User Greeting Block Card */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-900/40 border border-slate-800 rounded-2xl p-6 mb-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xl">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Welcome Back!</h1>
            <p className="text-gray-400 text-sm mt-0.5">{currentUser?.email}</p>
          </div>
          <button 
            onClick={() => navigate("/profile")}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-semibold rounded-xl transition-all"
          >
            ⚙️ Edit Profile Address
          </button>
        </div>

        <h2 className="text-xl font-bold mb-4 tracking-tight">Your Order History</h2>

        {userOrders.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 p-12 text-center rounded-2xl">
            <p className="text-4xl mb-2">📦</p>
            <p className="text-gray-400 text-sm font-medium">You haven't requested any engine parts or kits yet.</p>
            <button 
              onClick={() => navigate("/products")}
              className="mt-4 px-5 py-2 bg-orange-500 text-xs font-bold rounded-lg hover:bg-orange-600 transition-colors"
            >
              Browse Catalog
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {userOrders.map((order) => (
              <div 
                key={order.id} 
                onClick={() => navigate(`/orders/${order.id}`)}
                className="bg-slate-900 border border-slate-800/60 p-5 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 cursor-pointer hover:border-orange-500/30 transition-all hover:-translate-y-0.5"
              >
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-sm font-bold text-gray-300">#{order.id.slice(0, 8).toUpperCase()}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      order.status === "delivered" ? "bg-green-500/10 text-green-400 border border-green-500/20" :
                      order.status === "shipped" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                      "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    }`}>{order.status || "pending"}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Ordered on: {new Date(order.createdAt).toLocaleDateString()}</p>
                  <p className="text-xs text-gray-400 mt-2 line-clamp-1">
                    {order.items?.map(i => `${i.name} (x${i.quantity})`).join(", ")}
                  </p>
                </div>

                <div className="text-right flex md:flex-col items-center md:items-end justify-between w-full md:w-auto border-t border-slate-800 md:border-0 pt-3 md:pt-0">
                  <span className="text-gray-500 text-[10px] uppercase font-bold tracking-widest block mb-0.5">Amount Paid</span>
                  <span className="text-orange-500 font-mono font-bold text-lg">₹{Number(order.totalAmount ?? order.total ?? 0).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}