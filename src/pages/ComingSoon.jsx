import { Link } from 'react-router-dom';
import { PARTSWALA_LAUNCH_IST } from '../../shared/preLaunch.js';

export default function ComingSoonPage({ videoUrl = '' }) {
  const hasVideo = typeof videoUrl === 'string' && videoUrl.trim().length > 0;

  return (
    <div className="min-h-screen bg-[#020514] text-white flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-5xl rounded-[28px] border border-slate-800/80 bg-slate-950/70 shadow-2xl shadow-sky-500/10 backdrop-blur">
        <div className="px-6 py-8 md:px-10 lg:px-14 lg:py-12">
          <div className="mb-5 inline-flex items-center rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-sky-200">
            PARTSWALA IND
          </div>
          <p className="mb-3 text-sm uppercase tracking-[0.2em] text-slate-300">India’s automotive parts marketplace</p>
          <h1 className="text-3xl font-black tracking-tight text-white md:text-5xl">
            PARTSWALAIND — Launching 8 November 2026
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
            We’re preparing the next generation of B2B automotive parts buying and selling. The marketplace opens automatically at {PARTSWALA_LAUNCH_IST} IST.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <Link to="/admin/login" className="font-medium text-sky-300 underline decoration-sky-400/60 underline-offset-4 transition hover:text-sky-200">
              Administrator sign in
            </Link>
            <Link to="/vendor/login" className="ml-5 font-medium text-slate-300 underline decoration-slate-500 underline-offset-4 transition hover:text-white">
              Approved vendor sign in
            </Link>
          </div>
        </div>

        {hasVideo ? (
          <div className="border-t border-slate-800 px-6 py-6 md:px-10 lg:px-14">
            <video className="w-full rounded-2xl border border-slate-700 bg-black" src={videoUrl} controls playsInline preload="metadata" muted />
          </div>
        ) : null}
      </div>
    </div>
  );
}
