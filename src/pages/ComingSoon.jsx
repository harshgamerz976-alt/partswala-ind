import { Link } from 'react-router-dom';

export default function ComingSoonPage({ videoUrl = '' }) {
  const hasVideo = typeof videoUrl === 'string' && videoUrl.trim().length > 0;

  return (
    <div className="coming-soon-page">
      <div className="coming-soon-shell">
        <div className="coming-soon-card">
          <div className="coming-soon-brand">
            <span className="coming-soon-badge">PARTSWALA IND</span>
          </div>

          <p className="coming-soon-kicker">India's Automotive Parts Marketplace</p>
          <h1>COMING SOON</h1>
          <p className="coming-soon-copy">We’re getting ready to launch. Stay tuned for the next upgrade in automotive parts shopping.</p>
          <p className="coming-soon-copy"><Link to="/admin/login">Administrator? Sign in to manage site access.</Link></p>

          {hasVideo ? (
            <div className="coming-soon-video-wrap">
              <video
                className="coming-soon-video"
                src={videoUrl}
                controls
                playsInline
                preload="metadata"
                muted
              />
            </div>
          ) : (
            <div className="coming-soon-visual">
              <div className="coming-soon-visual-ring" />
              <div className="coming-soon-visual-core" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
