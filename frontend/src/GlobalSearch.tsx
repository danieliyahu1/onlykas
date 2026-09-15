import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "./Icons.js";

export function GlobalSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery(new URLSearchParams(location.search).get("q") ?? "");
  }, [location.search]);

  if (location.pathname === "/find") return null;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (value) navigate(`/find?q=${encodeURIComponent(value)}`);
  }

  return (
    <form className="global-search" onSubmit={submitSearch} role="search">
      <label htmlFor="global-search-input" className="sr-only">
        Search by name or Kaspa address
      </label>
      <input
        id="global-search-input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name or Kaspa address"
        autoComplete="off"
        spellCheck={false}
      />
      <button type="submit" aria-label="Search">
        <Icon name="search" />
      </button>
    </form>
  );
}
