import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";

const Stats = () => {
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalSales: 0,
  });

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "orders"),
      (snapshot) => {
        let totalCount = snapshot.size;
        let salesSum = 0;

        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          salesSum += Number(data.totalAmount || data.price || 0);
        });

        setStats({
          totalOrders: totalCount,
          totalSales: salesSum,
        });
      },
      (error) => {
        console.warn("Stats component: Access restricted or permission denied.", error.message);
        setStats({
          totalOrders: 0,
          totalSales: 0,
        });
      }
    );

    return () => unsubscribe();
  }, []);

  return (
    <div className="max-w-7xl mx-auto my-8 p-6 bg-slate-900/60 rounded-2xl border border-slate-800">
      <h3 className="text-xl font-bold text-white mb-4">Dashboard Statistics</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-slate-800/80 rounded-xl border border-slate-700">
          <p className="text-sm text-slate-400">Total Orders</p>
          <p className="text-2xl font-black text-orange-500">{stats.totalOrders}</p>
        </div>
        <div className="p-4 bg-slate-800/80 rounded-xl border border-slate-700">
          <p className="text-sm text-slate-400">Total Sales</p>
          <p className="text-2xl font-black text-emerald-400">₹{stats.totalSales.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
};

export default Stats;