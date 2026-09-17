import { Link } from "react-router-dom";

const STEPS = [
  {
    title: "Publish",
    body: "Add a photo or video. Set a price, or offer a subscription.",
  },
  {
    title: "Subscribe",
    body: "See everything, or pay for a single post.",
  },
  {
    title: "Get paid",
    body: "The money goes straight to you. You keep 99%.",
  },
];

export function HomePage() {
  return (
    <section className="home-page">
      <header className="home-intro">
        <h1>Creators and their subscribers, directly.</h1>
        <p className="home-lede">
          OnlyKas is built on Kaspa. Subscribe to a creator, and you're in.
        </p>
      </header>
      <div className="home-doors">
        <Link className="primary" to="/creators">
          Explore creators
        </Link>
        <Link className="secondary" to="/publish">
          Publish a post
        </Link>
      </div>
      <ol className="home-steps">
        {STEPS.map((step) => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <span>{step.body}</span>
          </li>
        ))}
      </ol>
      <div className="home-trust">
        <p className="home-trust-claim">
          Kaspa decides who can see a post — and anyone can check.
        </p>
        <p className="home-trust-note">
          OnlyKas stores the photos and videos, and follows the rules.
        </p>
      </div>
    </section>
  );
}
