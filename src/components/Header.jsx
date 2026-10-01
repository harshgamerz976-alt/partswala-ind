import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { useCart } from '../context/useCart';
import { getProductsPage } from '../services/productService';

const PistonAssembly3D = lazy(() => import('./PistonAssembly3D'));

export default function Header() {
  const { user, userProfile, isVendor, isAdmin } = useAuth();
  const { getCartCount } = useCart();
  const navigate = useNavigate();
  const [scrollProgress, setScrollProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchProducts, setSearchProducts] = useState([]);
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

    getProductsPage(null, 100)
      .then((page) => {
        if (isMounted) setSearchProducts(page.products || []);
      })
      .catch(() => {
        if (isMounted) setSearchProducts([]);
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
  }, []);

  const isLoggedIn = !!user;
  const accountLabel = isAdmin
    ? "ADMIN"
    : isVendor
      ? userProfile?.vendorProfile?.businessName || userProfile?.displayName || "VENDOR"
      : isLoggedIn ? "CUSTOMER" : "";
  const cartCount = getCartCount();
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
      <nav className="header-nav bg-[#020514] border-b border-orange-500/20 text-white px-6 py-4 flex items-center justify-between">
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
          <Link to="/orders" className="hover:text-white transition-colors">Orders</Link>
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
              {searchResults.length > 0 ? searchResults.map((product) => (
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
                <div className="header-search-empty">No matching parts found</div>
              )}
            </div>
          )}
        </div>

        {/* Cart Icon */}
        <Link id="cart-icon" to="/cart" aria-label={`Cart with ${cartCount} items`} className="relative text-slate-400 hover:text-white transition-colors flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 0a2 2 0 11-4 0 2 2 0 014 0z"/>
          </svg>
          {cartCount > 0 && <span className="header-cart-count">{cartCount}</span>}
        </Link>

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
      </nav>
    </>
  );
}