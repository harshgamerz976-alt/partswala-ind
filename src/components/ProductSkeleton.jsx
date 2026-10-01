// src/components/ProductSkeleton.jsx
export default function ProductSkeleton() {
  return (
    <div className="bg-slate-800 border border-slate-700/60 rounded-2xl overflow-hidden flex flex-col h-[380px] animate-pulse">
      {/* Animated Glowing Image Block */}
      <div className="h-48 bg-slate-750 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-700/20 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
      </div>
      
      {/* Content Skeleton Lines */}
      <div className="p-5 flex flex-col flex-1 space-y-4">
        {/* Category Badge Line */}
        <div className="h-4 w-16 bg-slate-700 rounded-md"></div>
        
        {/* Title Lines */}
        <div className="space-y-2 flex-1">
          <div className="h-5 w-5/6 bg-slate-700 rounded-lg"></div>
          <div className="h-5 w-2/3 bg-slate-700 rounded-lg"></div>
        </div>
        
        {/* Price & Button Row */}
        <div className="flex items-center justify-between pt-2">
          <div className="h-6 w-20 bg-slate-700 rounded-lg"></div>
          <div className="h-10 w-28 bg-slate-700 rounded-xl"></div>
        </div>
      </div>
    </div>
  );
}