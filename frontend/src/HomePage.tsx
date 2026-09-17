import { Link } from "react-router-dom";

const STEPS = [
  {
    title: "Publish",
    body: "Add a photo or video. Set a price, or share it for free.",
  },
  {
    title: "Unlock",
    body: "Fans pay KAS to see a creator's paid posts.",
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
        <h1>Paid posts, fan to creator.</h1>
        <p className="home-lede">
          OnlyKas is built on Kaspa. Fans pay creators directly.
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
          Kaspa decides who can unlock a post — and anyone can check.
        </p>
        <p className="home-trust-note">
          OnlyKas stores the photos and videos, and follows the rules.
        </p>
      </div>
    </section>
  );
}
