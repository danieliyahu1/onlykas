import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Message({
  title,
  center = false,
  children,
}: {
  title: string;
  center?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={center ? "message is-centered" : "message"}>
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
