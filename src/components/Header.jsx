import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { getProductsPage } from '../services/productService';
import NotificationBell from './NotificationBell.jsx';

const PistonAssembly3D = lazy(() => import('./PistonAssembly3D'));

export default function Header() {
  const { user, userProfile, isVendor, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [scrollProgress, setScrollProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchProducts, setSearchProducts] = useState([]);
  const [searchProductsLoading, setSearchProductsLoading] = useState(true);
  const [searchProductsError, setSearchProductsError] = useState(false);
  const [searchReloadCount, setSearchReloadCount] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showPiston, setShowPiston] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    const updateScrollProgress = () => {
      const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollableHeight > 0 ? (window.scrollY / scrollableHeight) * 100 : 0;
      setScrollProgress(Math.min(100, Math.max(0, progress)));
    };

    updateScrollProgress();
    window.addEventListener('scroll', updateScrollProgress, { passive: true });
    window.addEventListener('resize', updateScrollProgress);

    return () => {
      window.removeEventListener('scroll', updateScrollProgress);
      window.removeEventListener('resize', updateScrollProgress);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    setSearchProductsLoading(true);
    setSearchProductsError(false);

    getProductsPage(null, 100)
      .then((page) => {
        if (isMounted) setSearchProducts(page.products);
      })
      .catch((error) => {
        console.error('Header product search could not be loaded:', error);
        if (isMounted) {
          setSearchProducts([]);
          setSearchProductsError(true);
        }
      })
      .finally(() => {
        if (isMounted) setSearchProductsLoading(false);
      });

    const handleOutsideClick = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      isMounted = false;
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [searchReloadCount]);

  const isLoggedIn = !!user;
  const accountLabel = isAdmin
    ? "ADMIN"
    : isVendor
      ? userProfile?.vendorProfile?.businessName || userProfile?.displayName || "VENDOR"
      : isLoggedIn ? "CUSTOMER" : "";
  const enquiriesPath = isVendor ? "/vendor/enquiries" : "/my-enquiries";
  const enquiriesLabel = isVendor ? "Supplier enquiries" : "My enquiries";
  const searchResults = searchProducts.filter((product) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return false;
    return `${product.name || ''} ${product.brand || ''} ${product.partNumber || ''} ${product.category || ''}`
      .toLowerCase()
      .includes(query);
  }).slice(0, 6);

  function handleSearchSubmit(event) {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearchOpen(false);
    navigate(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
  }

  const getInitial = () => {
    if (userProfile?.fullName) return userProfile.fullName.charAt(0).toUpperCase();
    if (user?.displayName) return user.displayName.charAt(0).toUpperCase();
    return 'U';
  };

  return (
    <>
      <div
        className="scroll-progress-track"
        role="progressbar"
        aria-label="Page scroll progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(scrollProgress)}
      >
        <div className="scroll-progress-bar" style={{ width: `${scrollProgress}%` }} />
      </div>
      <nav className="header-nav bg-[#020514] border-b border-orange-500/20 text-white px-4 md:px-6 py-4 flex flex-wrap items-center justify-between">
      <div className="flex items-center space-x-8">
        <div className="header-brand-with-wheel" onPointerEnter={() => setShowPiston(true)} onFocusCapture={() => setShowPiston(true)}>
          <Link to="/" className="header-brand-lockup">
            <span className="header-brand-name"><span className="partswala-shimmer">PARTSWALA</span> <span className="bg-[#f97316] text-black text-[10px] font-bold px-1.5 py-0.5 rounded ml-1">IND</span></span>
            {accountLabel && <span className={`header-account-role ${isAdmin ? "is-admin" : isVendor ? "is-vendor" : "is-customer"}`}>{accountLabel}</span>}
          </Link>
          {showPiston
            ? <Suspense fallback={<span className="piston-assembly3d-placeholder" aria-hidden="true" />}><PistonAssembly3D /></Suspense>
            : <span className="piston-assembly3d-placeholder" aria-hidden="true" />}
        </div>
        <div className="hidden md:flex items-center space-x-6 text-sm font-medium text-slate-300">
          <Link to="/" className="hover:text-white transition-colors">Home</Link>
          <Link to="/products" className="hover:text-white transition-colors">Products</Link>
          {!isAdmin && <Link to={enquiriesPath} className="hover:text-white transition-colors">{enquiriesLabel}</Link>}
          {isVendor && <Link to="/vendor" className="hover:text-white transition-colors">Dashboard</Link>}
          {isAdmin && (
            <Link 
              to="/admin" 
              className="text-[#f97316] font-bold hover:text-[#ea580c] transition-colors border border-[#f97316]/30 px-2.5 py-0.5 rounded bg-[#f97316]/5 uppercase text-xs tracking-wider"
            >
              Admin Panel
            </Link>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-6">
        <div ref={searchRef} className="header-search relative hidden lg:block w-64">
          <form onSubmit={handleSearchSubmit}>
            <input
              type="search"
              placeholder="Search truck spare parts..."
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              aria-label="Search truck spare parts"
              className="w-full bg-slate-900 border border-slate-700 text-xs px-3 py-2 rounded-lg text-white focus:outline-none focus:border-[#f97316]"
            />
          </form>
          {isSearchOpen && searchQuery.trim() && (
            <div className="header-search-results">
              {searchProductsLoading ? (
                <div className="header-search-empty" role="status">Loading parts...</div>
              ) : searchProductsError ? (
                <div className="header-search-empty" role="alert">
                  Part search is unavailable.
                  <button type="button" onClick={() => setSearchReloadCount((count) => count + 1)}>Try again</button>
                </div>
              ) : searchResults.length > 0 ? searchResults.map((product) => (
                <Link
                  key={product.id}
                  to={`/products/${product.id}`}
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearchQuery('');
                  }}
                  className="header-search-result"
                >
                  <div className="header-search-result-image">
                    {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span>⚙</span>}
                  </div>
                  <div className="header-search-result-copy">
                    <strong>{product.name || product.title || 'Unnamed part'}</strong>
                    <span>{product.partNumber || product.category || 'Truck component'}</span>
                  </div>
                  <b>₹{product.price?.toLocaleString() || '—'}</b>
                </Link>
              )) : (
                <div className="header-search-empty" role="status">No matching parts found</div>
              )}
            </div>
          )}
        </div>

        <NotificationBell />

        {/* Profile Avatar / Login Toggle */}
        {isLoggedIn ? (
          <button 
            onClick={() => navigate('/profile')} 
            className="focus:outline-none transition-transform active:scale-95 flex items-center justify-center rounded-full"
          >
            {userProfile?.photoURL ? (
              <img 
                src={userProfile.photoURL} 
                alt="Profile" 
                className="w-9 h-9 rounded-full object-cover border-2 border-[#f97316] shadow-md"
                onError={(e) => { 
                  e.target.style.display = 'none';
                  if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div 
              className="w-9 h-9 rounded-full bg-[#f97316] text-white items-center justify-center font-bold text-sm border border-[#ea580c] shadow-md"
              style={{ display: userProfile?.photoURL ? 'none' : 'flex' }}
            >
              {getInitial()}
            </div>
          </button>
        ) : (
          <Link to="/login" className="bg-[#f97316] hover:bg-[#ea580c] text-white text-xs font-bold px-5 py-2 rounded-lg transition-all tracking-wider uppercase shadow-md">
            Login
          </Link>
        )}
      </div>
      <div className="md:hidden basis-full flex items-center gap-5 overflow-x-auto border-t border-slate-800 pt-3 text-sm font-medium text-slate-300">
        <Link to="/" className="shrink-0 hover:text-white">Home</Link>
        <Link to="/products" className="shrink-0 hover:text-white">Products</Link>
        {!isAdmin && <Link to={enquiriesPath} className="shrink-0 hover:text-white">{enquiriesLabel}</Link>}
        {isVendor && <Link to="/vendor" className="shrink-0 hover:text-white">Dashboard</Link>}
        {isAdmin && <Link to="/admin" className="shrink-0 font-semibold text-orange-400">Admin</Link>}
      </div>
      <form className="md:hidden basis-full pt-3" onSubmit={handleSearchSubmit}>
        <input
          type="search"
          placeholder="Search truck spare parts..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          aria-label="Search truck spare parts"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
        />
      </form>
      </nav>
    </>
  );
}