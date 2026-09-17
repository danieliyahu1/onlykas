import { Link } from "react-router-dom";

const STEPS = [
  {
    title: "Publish",
    body: "Add a photo or video and set your price — or share it for free.",
  },
  {
    title: "Get paid",
    body: "Supporters unlock your posts with KAS. No middleman holds your money.",
  },
  {
    title: "Keep 99%",
    body: "Every paid post pays out straight to your wallet.",
  },
];

export function HomePage() {
  return (
    <section className="home-page">
      <header className="home-intro">
        <p className="home-kicker">Paid posts on Kaspa</p>
        <h1>Get paid for what you post.</h1>
        <p className="home-lede">
          Publish your work, name your price, and get paid in KAS. Or support the
          creators you follow.
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
    </section>
  );
}
