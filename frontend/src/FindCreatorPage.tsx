import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isKaspaTestnetAddress, type CreatorSearchResult } from "@onlykas/shared";
import { api, ApiError } from "./kasware.js";
import { Icon } from "./Icons.js";
import { Spinner } from "./Spinner.js";
import { useAutoDismiss } from "./useAutoDismiss.js";
import { creatorPath } from "./creator-url.js";

export function FindCreatorPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreatorSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const handledQuery = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useAutoDismiss(error, () => setError(null));

  function runSearch(rawValue: string) {
    const value = rawValue.trim();
    handledQuery.current = value;
    request.current?.abort();
    request.current = null;
    setQuery(value);
    setResults([]);
    setSearched(false);
    setError(null);
    if (!value) {
      setSearching(false);
      return;
    }
    if (isKaspaTestnetAddress(value)) {
      navigate(creatorPath(value), { replace: true });
      setSearching(false);
      return;
    }
    if (value.startsWith("kaspatest:")) {
      setError("Enter the full address.");
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setSearching(true);
    void api<CreatorSearchResult[]>(
      `/api/creators/search?q=${encodeURIComponent(value)}`,
      { signal: controller.signal },
    )
      .then((found) => {
        if (request.current !== controller) return;
        setResults(found);
        setSearched(true);
      })
      .catch((caught: unknown) => {
        if (request.current !== controller) return;
        setError(
          caught instanceof ApiError ? caught.message : "Search failed. Try again.",
        );
      })
      .finally(() => {
        if (request.current === controller) setSearching(false);
      });
  }

  // Only external URL changes (header search, history) reach here. Submissions
  // run directly and record the query, so their own URL write is skipped.
  useEffect(() => {
    const value = searchParams.get("q")?.trim() ?? "";
    if (value === handledQuery.current) return;
    runSearch(value);
  }, [navigate, searchParams]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    setSearchParams({ q: value }, { replace: true });
    runSearch(value);
  }

  return (
    <section className="find-page">
      <header>
        <h1>Find a creator.</h1>
      </header>
      <form
        className="find-search search-bar"
        onSubmit={search}
        noValidate
        role="search"
      >
        <label htmlFor="creator-query" className="sr-only">
          Name or address
        </label>
        <input
          id="creator-query"
          name="creator-query"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setResults([]);
            setError(null);
            setSearched(false);
          }}
          placeholder="Name or Kaspa address"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" aria-label="Search" disabled={searching}>
          {searching ? <Spinner /> : <Icon name="search" />}
        </button>
      </form>
      {error && (
        <p className="feedback inline error" role="alert">
          {error}
        </p>
      )}
      {searched && !searching && results.length === 0 && !error && (
        <p className="feedback">No creators found.</p>
      )}
      <div className="creator-results">
        {results.map((result) => (
          <button
            className="creator-result"
            key={result.address}
            onClick={() => navigate(creatorPath(result.address))}
          >
            <strong>{result.displayName ?? result.displayAddress}</strong>
            {result.displayName && <span>{result.displayAddress}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
