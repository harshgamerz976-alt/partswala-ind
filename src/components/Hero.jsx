import React from 'react';
import { Link } from 'react-router-dom';

export default function Hero() {
  const trustBadges = [
    { icon: '🚚', title: 'Pan-India Delivery', desc: 'Fast surface logistics networks' },
    { icon: '🛠️', title: '100% Genuine Parts', desc: 'Direct OEM/OES verification' },
    { icon: '🔒', title: 'Secure Gateway', desc: 'Encrypted industry transactions' },
    { icon: '👨‍🔧', title: 'Expert Match Tech', desc: 'VIN/Chassis validation systems' }
  ];

  return (
    <section className="relative w-full min-h-[calc(100vh-5rem)] flex flex-col justify-between bg-slate-950 text-white overflow-hidden">
      
      {/* Structural Visual Canvas Layer */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-r from-[#0f172a] via-[#0f172a]/85 to-transparent z-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-transparent to-transparent z-10" />
        <img 
          src="https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?q=80&w=2070&auto=format&fit=crop" 
          alt="Heavy-duty transport fleet logistical operations setup representing PartsWala structural components"
          className="w-full h-full object-cover object-center transform scale-105 motion-safe:animate-[pulse_8s_ease-in-out_infinite]"
        />
      </div>

      {/* Main Core Typography Presentation Layout */}
      <div className="relative z-20 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex-grow flex items-center py-12 lg:py-20">
        <div className="max-w-2xl space-y-6">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#f97316]/10 border border-[#f97316]/30">
            <span className="text-xs font-bold tracking-widest text-[#f97316] uppercase animate-pulse">⚡ Mega Electrical & Mechanical Sale</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f97316] text-white font-black font-mono">ELECTRICAL15</span>
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-none text-white">
            India's Trusted Hub For <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#f97316] to-orange-400">
              Genuine Truck Parts
            </span>
          </h1>
          
          <p className="text-base sm:text-lg text-slate-300 font-normal leading-relaxed max-w-xl">
            Direct access engine blocks, transmission configurations, heavy duty suspension systems, and certified electrical arrays engineered for structural truck operations.
          </p>
          
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Link 
              to="/products" 
              className="inline-flex items-center justify-center px-8 h-12 text-sm font-bold tracking-wider uppercase text-white bg-[#f97316] hover:bg-[#ea580c] transition-all duration-200 rounded-lg shadow-lg shadow-[#f97316]/20 transform hover:-translate-y-0.5"
            >
              Shop Collection
            </Link>
            <a 
              href="#categories" 
              className="inline-flex items-center justify-center px-8 h-12 text-sm font-bold tracking-wider uppercase text-white bg-slate-800/80 hover:bg-slate-700/90 border border-slate-700 rounded-lg transition-all duration-200 backdrop-blur-sm"
            >
              Explore Parts
            </a>
          </div>
        </div>
      </div>

      {/* Embedded Edge-to-Edge Grid Feature Section */}
      <div className="relative z-20 w-full backdrop-blur-md bg-slate-900/60 border-t border-slate-800/80 py-6">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            {trustBadges.map((badge, index) => (
              <div key={index} className="flex items-start space-x-3 group">
                <span className="text-2xl mt-0.5 transform transition-transform duration-300 group-hover:scale-110 shrink-0">{badge.icon}</span>
                <div>
                  <h4 className="text-sm font-bold text-white tracking-wide">{badge.title}</h4>
                  <p className="text-xs text-slate-400 mt-0.5 font-medium leading-normal">{badge.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}