import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

export default function Navbar({ cartCount = 0, user = null, onLogout }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      setIsMobileMenuOpen(false);
    }
  };

  const navLinks = [
    { name: "Home", path: "/" },
    { name: "Products", path: "/products" },
    { name: "Orders", path: "/orders" },
  ];

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  // Extract initial for user avatar
  const getUserInitial = () => {
    if (!user) return 'U';
    if (user.displayName) return user.displayName.charAt(0).toUpperCase();
    if (user.email) return user.email.charAt(0).toUpperCase();
    return 'U';
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 w-full h-20 bg-[#090d16]/90 backdrop-blur-md border-b border-slate-800/80 transition-all duration-300">
      <div className="w-full max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-x-6">
        
        {/* Brand Logo */}
        <Link to="/" className="flex items-center shrink-0">
          <span className="text-2xl font-black tracking-tighter text-white">
            PARTS<span className="text-[#f97316]">WALA</span> <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-[#f97316]/20 text-[#f97316] tracking-normal align-middle ml-1">IND</span>
          </span>
        </Link>

        {/* Desktop Links */}
        <div className="hidden lg:flex items-center gap-x-6 shrink-0">
          {navLinks.map((link) => (
            <Link
              key={link.name}
              to={link.path}
              className={`text-sm font-semibold tracking-wide transition-colors duration-200 hover:text-[#f97316] shrink-0 ${
                isActive(link.path) ? 'text-[#f97316]' : 'text-slate-300'
              }`}
            >
              {link.name}
            </Link>
          ))}
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="hidden md:flex relative flex-grow max-w-xs items-center">
          <input
            type="text"
            placeholder="Search truck spare parts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-4 pr-10 text-sm bg-slate-900/80 border border-slate-700/80 rounded-full focus:outline-none focus:border-[#f97316] text-white transition-all duration-200 placeholder-slate-400"
          />
          <button type="submit" className="absolute right-3 text-slate-400 hover:text-[#f97316] transition-colors cursor-pointer">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </form>

        {/* Action Controls */}
        <div className="flex items-center gap-x-4 shrink-0">
          {/* Cart Link */}
          <Link to="/cart" className="relative p-2 text-slate-300 hover:text-[#f97316] transition-colors rounded-full hover:bg-slate-800/50 shrink-0">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            {cartCount > 0 && (
              <span className="absolute top-0 right-0 min-w-5 h-5 px-1 flex items-center justify-center text-xs font-black text-white bg-[#f97316] rounded-full ring-2 ring-[#0f172a]">
                {cartCount}
              </span>
            )}
          </Link>

          {/* Account Button / Profile Link */}
          {user ? (
            <Link to="/profile" className="flex items-center space-x-2 p-1 pr-3 rounded-full bg-slate-800/60 border border-slate-700/50 hover:border-[#f97316] transition-all shrink-0">
              <div className="w-8 h-8 rounded-full bg-[#f97316] flex items-center justify-center text-white font-bold text-sm shadow-md">
                {getUserInitial()}
              </div>
              <span className="text-xs font-semibold text-slate-200 hidden md:inline max-w-[90px] truncate">
                {user.displayName || user.email?.split('@')[0] || 'Account'}
              </span>
            </Link>
          ) : (
            <Link to="/login" className="inline-flex items-center justify-center px-5 h-10 text-xs font-bold tracking-wider text-white uppercase bg-[#f97316] hover:bg-[#ea580c] rounded-full transition-all duration-200 shadow-md shadow-[#f97316]/10 shrink-0">
              Login
            </Link>
          )}

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 lg:hidden text-slate-300 hover:text-[#f97316] transition-colors rounded-full focus:outline-none shrink-0 cursor-pointer"
            aria-label="Toggle navigation"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isMobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-x-0 top-20 bg-[#090d16]/98 backdrop-blur-xl border-b border-slate-800 shadow-2xl transition-all duration-300 max-h-[calc(100vh-5rem)] overflow-y-auto">
          <div className="px-4 pt-4 pb-6 space-y-3">
            <form onSubmit={handleSearchSubmit} className="relative w-full flex items-center mb-4">
              <input
                type="text"
                placeholder="Search truck spare parts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-11 pl-4 pr-10 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
              <button type="submit" className="absolute right-3 text-slate-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </form>

            {navLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`block px-4 py-2.5 rounded-lg text-base font-medium tracking-wide ${
                  isActive(link.path) ? 'bg-[#f97316]/10 text-[#f97316]' : 'text-slate-300 hover:bg-slate-800/50'
                }`}
              >
                {link.name}
              </Link>
            ))}

            <div className="pt-4 border-t border-slate-800/80 mt-4">
              {user ? (
                <div className="space-y-2">
                  <Link
                    to="/profile"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-white bg-slate-800/60 rounded-lg border border-slate-700/50"
                  >
                    <span>My Profile</span>
                    <span className="text-xs text-orange-400">View</span>
                  </Link>
                  {onLogout && (
                    <button
                      onClick={() => {
                        onLogout();
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-center h-11 text-sm font-bold tracking-wider text-red-400 uppercase bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-all"
                    >
                      Logout
                    </button>
                  )}
                </div>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="w-full flex items-center justify-center h-11 text-sm font-bold tracking-wider text-white uppercase bg-[#f97316] rounded-lg"
                >
                  Login / Register
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}