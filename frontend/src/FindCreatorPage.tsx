import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { COPY, isKaspaTestnetAddress } from "@onlykas/shared";

export function FindCreatorPage() {
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  function openProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = address.trim();
    if (!isKaspaTestnetAddress(value)) {
      setError(COPY.invalidCreatorAddress);
      return;
    }
    setError(null);
    navigate(`/creator/${encodeURIComponent(value)}`);
  }

  return (
    <section className="find-page">
      <header>
        <p className="eyebrow">FIND A CREATOR</p>
        <h1>Open any creator.</h1>
        <p className="find-intro">Paste their complete Kaspa address.</p>
      </header>
      <form onSubmit={openProfile} noValidate>
        <label htmlFor="creator-address">
          Creator address
          <input
            id="creator-address"
            name="creator-address"
            type="text"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              if (error) setError(null);
            }}
            placeholder="kaspatest:..."
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "creator-address-error" : undefined}
          />
        </label>
        {error && (
          <p className="feedback error" id="creator-address-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit">
          Open profile <span aria-hidden="true">-&gt;</span>
        </button>
      </form>
    </section>
  );
}
