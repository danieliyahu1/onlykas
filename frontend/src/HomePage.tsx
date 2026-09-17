import { Link } from "react-router-dom";
import { LockIcon } from "./Icons.js";

export function HomePage() {
  return (
    <section className="home-page">
      <div className="home-hero">
        <header className="home-intro">
          <h1>Get paid by the people who love your work.</h1>
          <p className="home-lede">
            Publish a photo or a video. Set your price. Your subscribers pay you
            directly — you keep 99%.
          </p>
          <div className="home-doors">
            <Link className="primary" to="/publish">
              Start publishing
            </Link>
            <Link className="home-skip" to="/creators">
              See creators
            </Link>
          </div>
          <p className="home-note">
            Your work is seen by the people who pay for it.
          </p>
        </header>
        <CreatorPreview />
      </div>
    </section>
  );
}

function CreatorPreview() {
  return (
    <figure className="home-preview">
      <figcaption className="home-preview-caption">
        What your subscribers see
      </figcaption>
      <div
        className="preview-card"
        role="img"
        aria-label="A creator's page on OnlyKas: a members-only video post priced at 5 KAS, with a Subscribe button."
      >
        <div className="preview-head">
          <span className="preview-avatar">A</span>
          <span className="preview-identity">
            <strong>Amara Okoye</strong>
            <span className="preview-address">kaspatest:qq…8v4k</span>
          </span>
        </div>
        <div className="preview-post">
          <span className="preview-thumb" />
          <span className="preview-post-copy">
            <strong>Studio, Sunday — the long version</strong>
            <span className="preview-post-meta">8:24 · Members only</span>
          </span>
          <span className="preview-lock">
            <LockIcon open={false} />
          </span>
        </div>
        <span className="preview-action">Subscribe · 5 KAS a month</span>
      </div>
    </figure>
  );
}
