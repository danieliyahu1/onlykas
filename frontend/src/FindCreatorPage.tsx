import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  isKaspaTestnetAddress,
  type CreatorSearchResult,
} from "@onlykas/shared";
import { api } from "./kasware.js";
import { Icon } from "./Icons.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

export function FindCreatorPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreatorSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useAutoDismiss(error, () => setError(null));

  useEffect(() => {
    const value = searchParams.get("q")?.trim() ?? "";
    setQuery(value);
    if (!value) return;
    if (isKaspaTestnetAddress(value)) {
      navigate(`/creator/${encodeURIComponent(value)}`, { replace: true });
      return;
    }
    if (value.startsWith("kaspatest:")) {
      setError("Enter a complete Kaspa testnet address.");
      return;
    }
    setError(null);
    setResults([]);
    setSearched(false);
    setSearching(true);
    void api<CreatorSearchResult[]>(
      `/api/creators/search?q=${encodeURIComponent(value)}`,
    )
      .then((found) => {
        setResults(found);
        setSearched(true);
      })
      .catch(() => setError("Profiles could not be found. Try again."))
      .finally(() => setSearching(false));
  }, [navigate, searchParams]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    setSearchParams({ q: value });
  }

  return (
    <section className="find-page">
      <header>
        <p className="eyebrow">SEARCH</p>
        <h1>Find someone.</h1>
        <p className="find-intro">Search by name or paste a Kaspa address.</p>
      </header>
      <form onSubmit={search} noValidate>
        <label htmlFor="creator-query">
          Name or Kaspa address
          <input
            id="creator-query"
            name="creator-query"
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setError(null);
              setSearched(false);
            }}
            placeholder="Maya or kaspatest:..."
            autoComplete="off"
            spellCheck={false}
            aria-label="Name or Kaspa address"
          />
        </label>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={searching}>
          {searching ? "Searching..." : "Search"} <Icon name="search" />
        </button>
      </form>
      {searched && !searching && results.length === 0 && !error && (
        <p className="feedback">No profiles found.</p>
      )}
      <div className="creator-results">
        {results.map((result) => (
          <button
            className="creator-result"
            key={result.address}
            onClick={() =>
              navigate(`/creator/${encodeURIComponent(result.address)}`)
            }
          >
            <strong>{result.displayName}</strong>
            <span>{result.displayAddress}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
