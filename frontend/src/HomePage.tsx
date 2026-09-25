import { Link } from "react-router-dom";
import type { CreatorSearchResult } from "@kaskama/shared";
import * as homeCopy from "./home-copy.json";
import { COPY } from "./copy.js";
import { LockIcon } from "./Icons.js";
import { api } from "./kasware.js";
import { useAsyncResource } from "./useAsyncResource.js";
import { creatorPath } from "./creator-url.js";

export function HomePage() {
  return (
    <div className="home-page">
      <section className="home-section home-intro">
        <h1>{homeCopy.headline}</h1>
        <p className="home-lede">{homeCopy.lede}</p>
        <div className="home-actions">
          <Link className="primary" to="/publish">
            Start publishing
          </Link>
        </div>
      </section>

      <section className="home-section home-why">
        <h2 className="home-section-title">{homeCopy.moneyHeading}</h2>
        <p className="home-lede">{homeCopy.moneyIntro}</p>
        <ul className="home-money">
          {homeCopy.moneyPoints.map((point) => (
            <li key={point.claim}>
              <p className="money-claim">{point.claim}</p>
              <p className="money-detail">{point.detail}</p>
            </li>
          ))}
        </ul>
        <a
          className="home-powered"
          href="https://kaspa.org/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by Kaspa
        </a>
      </section>

      <section className="home-section">
        <h2 className="home-section-title">What your fans see</h2>
        <CreatorPreview />
      </section>

      <section className="home-section">
        <h2 className="home-section-title">{homeCopy.fanHeading}</h2>
        <p className="home-lede">{homeCopy.fanLede}</p>
        <FanCreators />
        <Link className="secondary" to="/creators">
          Browse creators
        </Link>
      </section>
    </div>
  );
}

function CreatorPreview() {
  return (
    <div
      className="preview-card"
      role="img"
      aria-label="A subscribed fan's view of a creator's profile on Kaskama: Yonatan Sompolinsky, creator-priced access for 30 days, marked Subscribed, with the unlocked post BlockDAG explanation with AI."
    >
      <div className="creator-identity">
        <h2 className="preview-name">Yonatan Sompolinsky</h2>
        <span className="wallet-address">kaspa:qpchy8…09rle5a7</span>
      </div>
      <div className="access-strip">
        <p className="access-facts">{COPY.membershipAccess}</p>
        <span className="access-status">Subscribed</span>
      </div>
      <div className="post-grid">
        <div className="post-card">
          <span className="post-lock unlocked">
            <LockIcon open={true} />
          </span>
          <div className="post-card-copy">
            <p>BlockDAG explanation with AI</p>
          </div>
          <span className="post-price">5 KAS</span>
        </div>
      </div>
    </div>
  );
}

function FanCreators() {
  const { data } = useAsyncResource(
    (signal) => api<CreatorSearchResult[]>("/api/creators/public", { signal }),
    [],
  );
  const creators = (data ?? []).filter((creator) => creator.displayName).slice(0, 4);
  if (!creators.length) return null;
  return (
    <ul className="fan-creators">
      {creators.map((creator) => (
        <li key={creator.address}>
          <Link to={creatorPath(creator.address)}>
            {creator.displayName}
          </Link>
        </li>
      ))}
    </ul>
  );
}
