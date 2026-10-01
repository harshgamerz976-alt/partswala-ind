import { useState, useCallback } from 'react';
import { ToastContext } from './toastContext';

// Capital-T Provider component
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  // useCallback prevents unnecessary re-renders in components calling addToast
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    
    setToasts((prev) => [...prev, { id, message, type }]);

    // Auto-remove toast after 3.5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  // Helper to remove a toast immediately by clicking it
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Helper styles based on toast types
  const getTypeStyles = (type) => {
    switch (type) {
      case 'success':
        return 'bg-emerald-600 border-emerald-500 text-white';
      case 'error':
        return 'bg-rose-600 border-rose-500 text-white';
      case 'warning':
        return 'bg-amber-500 border-amber-600 text-slate-950';
      case 'info':
      default:
        return 'bg-[#f97316] border-[#ea580c] text-white';
    }
  };

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      
      {/* Toast Notification Stack Overlay */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            className={`pointer-events-auto cursor-pointer p-4 rounded-xl shadow-2xl border text-xs font-bold uppercase tracking-wider flex items-center justify-between transition-all transform translate-y-0 animate-slideIn hover:scale-102 ${getTypeStyles(t.type)}`}
          >
            <span>{t.message}</span>
            <button 
              type="button" 
              className="ml-3 opacity-60 hover:opacity-100 transition-opacity"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}