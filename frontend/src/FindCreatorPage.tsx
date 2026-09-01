import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  isKaspaTestnetAddress,
  type CreatorSearchResult,
} from "@onlykas/shared";
import { api } from "./kasware.js";
import { Icon } from "./Icons.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

export function FindCreatorPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreatorSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useAutoDismiss(error, () => setError(null));

  function findCreator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (isKaspaTestnetAddress(value)) {
      navigate(`/creator/${encodeURIComponent(value)}`);
      return;
    }
    if (value.startsWith("kaspatest:")) {
      setError("Enter a complete Kaspa testnet address.");
      return;
    }
    setError(null);
    setResults([]);
    setSearching(true);
    void api<CreatorSearchResult[]>(
      `/api/creators/search?q=${encodeURIComponent(value)}`,
    )
      .then(setResults)
      .catch(() => setError("Creators could not be found. Try again."))
      .finally(() => setSearching(false));
  }

  return (
    <section className="find-page">
      <header>
        <p className="eyebrow">FIND A CREATOR</p>
        <h1>Open any creator.</h1>
        <p className="find-intro">
          Search by name or paste their Kaspa address.
        </p>
      </header>
      <form onSubmit={findCreator} noValidate>
        <label htmlFor="creator-query">
          Creator name or address
          <input
            id="creator-query"
            name="creator-query"
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setError(null);
            }}
            placeholder="Maya or kaspatest:..."
            autoComplete="off"
            spellCheck={false}
            aria-label="Creator address"
          />
        </label>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={searching}>
          {searching ? "Searching..." : "Open profile"} <Icon name="search" />
        </button>
      </form>
      {!searching && query.trim() && results.length === 0 && !error && (
        <p className="feedback">No creators found.</p>
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
