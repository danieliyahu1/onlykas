import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="message">
      <h1 className="message-title">{title}</h1>
      {children}
    </section>
  );
}

export function HomeLink() {
  return (
    <Link className="secondary" to="/">
      Go home
    </Link>
  );
}
