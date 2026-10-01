import React from "react";
import { useToast } from "../context/useToast";

export default function Toast() {
  const { toasts = [] } = useToast();
  const toast = toasts[toasts.length - 1];

  if (!toast) return null;

  const isSuccess = toast.type === "success";

  return (
    <div className="fixed bottom-5 right-5 z-50 transition-all transform duration-300 ease-in-out">
      <div
        className={`px-4 py-3 rounded-lg shadow-xl text-sm font-medium border flex items-center gap-3 ${
          isSuccess
            ? "bg-slate-900 border-emerald-500/50 text-emerald-400"
            : "bg-slate-900 border-red-500/50 text-red-400"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            isSuccess ? "bg-emerald-400" : "bg-red-400"
          }`}
        ></span>
        {toast.message}
      </div>
    </div>
  );
}