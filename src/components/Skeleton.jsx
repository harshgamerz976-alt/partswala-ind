export function ProductCardSkeleton() {
  return (
    <div className="bg-slate-800 rounded-2xl overflow-hidden border border-slate-700/50">
      <div className="h-48 skeleton-shimmer" />
      <div className="p-5 space-y-3">
        <div className="h-5 skeleton-shimmer rounded w-3/4" />
        <div className="h-3 skeleton-shimmer rounded w-1/2" />
        <div className="flex justify-between items-center pt-4">
          <div className="h-6 skeleton-shimmer rounded w-20" />
          <div className="h-9 skeleton-shimmer rounded-lg w-28" />
        </div>
      </div>
    </div>
  );
}

export function ProductDetailSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-12">
      <div className="h-4 skeleton-shimmer rounded w-48 mb-6" />
      <div className="grid md:grid-cols-2 gap-0 bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
        <div className="min-h-[400px] skeleton-shimmer" />
        <div className="p-8 md:p-10 space-y-4">
          <div className="flex gap-2">
            <div className="h-6 skeleton-shimmer rounded-full w-24" />
            <div className="h-6 skeleton-shimmer rounded-full w-20" />
          </div>
          <div className="h-10 skeleton-shimmer rounded w-3/4" />
          <div className="h-12 skeleton-shimmer rounded w-1/3" />
          <div className="space-y-2 py-4">
            <div className="h-3 skeleton-shimmer rounded w-full" />
            <div className="h-3 skeleton-shimmer rounded w-5/6" />
            <div className="h-3 skeleton-shimmer rounded w-4/6" />
          </div>
          <div className="h-14 skeleton-shimmer rounded-xl w-full mt-8" />
          <div className="h-14 skeleton-shimmer rounded-xl w-full" />
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 skeleton-shimmer rounded-lg border border-slate-700/50" />
      ))}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6">
      <div className="h-4 skeleton-shimmer rounded w-24 mb-3" />
      <div className="h-8 skeleton-shimmer rounded w-32" />
    </div>
  );
}