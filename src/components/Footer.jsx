import React from 'react';
import { Link } from 'react-router-dom';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const [wordmarkPointer, setWordmarkPointer] = React.useState({ x: 50, y: 50 });

  function handleWordmarkPointerMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setWordmarkPointer({
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    });
  }

  return (
    <footer className="site-footer">
      <div className="site-footer-panel">
        <div className="site-footer-columns">
          <div className="site-footer-brand">
            <Link to="/" className="site-footer-logo"><span>♥</span> PARTSWALA</Link>
            <p>India's modern destination for genuine commercial truck spare parts.</p>
          </div>

          <div>
            <h4>About Us</h4>
            <ul>
              <li><Link to="/">Our Story</Link></li>
              <li><Link to="/products">Our Products</Link></li>
              <li><Link to="/orders">Delivery Network</Link></li>
              <li><Link to="/profile">Careers</Link></li>
            </ul>
          </div>

          <div>
            <h4>Helpful Links</h4>
            <ul>
              <li><Link to="/products">FAQs</Link></li>
              <li><Link to="/profile">Support</Link></li>
              <li><Link to="/orders">Track Order <span className="footer-live-dot" /></Link></li>
            </ul>
          </div>

          <div>
            <h4>Contact Us</h4>
            <ul className="site-footer-contact">
              <li><span className="footer-icon">✉</span><a href="mailto:support@partswalaind.com">support@partswalaind.com</a></li>
              <li><span className="footer-icon">⌕</span><a href="tel:+918637373116">+91 86373 73116</a></li>
              <li><span className="footer-icon">⌖</span><span>Pan-India delivery</span></li>
            </ul>
          </div>
        </div>

        <div
          className="site-footer-mark-wrap"
          onPointerMove={handleWordmarkPointerMove}
          onPointerLeave={() => setWordmarkPointer({ x: 50, y: 50 })}
          style={{ "--wordmark-x": `${wordmarkPointer.x}%`, "--wordmark-y": `${wordmarkPointer.y}%` }}
        >
          <div className="site-footer-mark" aria-hidden="true">PARTSWALA</div>
          <div className="site-footer-mark site-footer-mark-highlight" aria-hidden="true">PARTSWALA</div>
        </div>
        <div className="site-footer-bottom">
          <span>© {currentYear} PARTSWALA. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
}