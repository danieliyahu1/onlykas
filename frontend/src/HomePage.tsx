import { Link } from "react-router-dom";
import type { CreatorSearchResult } from "@onlykas/shared";
import { COPY } from "./copy.js";
import { LockIcon } from "./Icons.js";
import { api } from "./kasware.js";
import { useAsyncResource } from "./useAsyncResource.js";
import { creatorPath } from "./creator-url.js";

export function HomePage() {
  return (
    <div className="home-page">
      <section className="home-section home-intro">
        <h1>Get paid by the people who love your work.</h1>
        <p className="home-lede">
          Publish a photo or a video. Set your price. You keep 99%.
        </p>
        <div className="home-actions">
          <Link className="primary" to="/publish">
            Start publishing
          </Link>
        </div>
      </section>

      <section className="home-section home-why">
        <h2 className="home-section-title">Where your money goes.</h2>
        <p className="home-lede">
          Three things creators want to know. OnlyKas answers all three.
        </p>
        <ul className="home-money">
          <li>
            <p className="money-claim">You keep 99%.</p>
            <p className="money-detail">
              OnlyKas takes 1%. That is the whole fee.
            </p>
          </li>
          <li>
            <p className="money-claim">You get paid on the spot.</p>
            <p className="money-detail">
              The moment a fan pays, the money is yours. No request, no
              minimum, no hold.
            </p>
          </li>
          <li>
            <p className="money-claim">No one can hold your money.</p>
            <p className="money-detail">
              The money goes straight from your fans to you.
            </p>
          </li>
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
        <h2 className="home-section-title">Here to support a creator?</h2>
        <p className="home-lede">
          Unlock their work or subscribe for a day. Your KAS goes straight to them.
        </p>
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
      aria-label="A subscribed fan's view of a creator's profile on OnlyKas: Yonatan Sompolinsky, one day of access for 10 KAS, marked Subscribed, with the unlocked post BlockDAG explanation with AI."
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
