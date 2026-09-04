import { useEffect, useState, type FormEvent } from "react";
import {
  COPY,
  validateMembershipOffer,
  type MembershipDeployResponse,
  type MembershipOfferResponse,
} from "@onlykas/shared";
import { api, ApiError, getWalletPublicKey, signPreparedPayment } from "./kasware.js";
import { KaspaMark } from "./KaspaMark.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

interface Props {
  address: string | null;
  signIn: () => Promise<string | null>;
  signingIn: boolean;
}

interface DeployError {
  code: string | null;
  message: string;
}

export function MembershipPage({ address, signIn, signingIn }: Props) {
  const [priceKas, setPriceKas] = useState("1");
  const [description, setDescription] = useState("A day of access.");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DeployError | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [deploy, setDeploy] = useState<MembershipDeployResponse | null>(null);
  const [polling, setPolling] = useState(false);
  const [offers, setOffers] = useState<MembershipOfferResponse[]>([]);

  useAutoDismiss(failure?.message ?? null, () => setFailure(null));

  useEffect(() => {
    if (!address || deploy?.state === "CONFIRMED") return;
    if (!deploy || !["PREPARED", "PENDING"].includes(deploy.state)) return;
    setPolling(true);
    const id = deploy.id;
    let cancelled = false;
    const tick = async () => {
      try {
        const current = await api<MembershipDeployResponse>(
          `/api/membership/deploys/${id}`,
        );
        if (cancelled) return;
        setDeploy(current);
        if (current.state === "CONFIRMED") {
          setStatus(COPY.offerLive);
          setPolling(false);
          await reloadOffers();
        }
      } catch {
        if (!cancelled) setPolling(false);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [address, deploy?.state, deploy?.id]);

  async function reloadOffers() {
    try {
      const result = await api<{ offers: MembershipOfferResponse[] }>(
        "/api/membership/offers",
      );
      setOffers(result.offers);
    } catch {
      // Offer list load is best-effort.
    }
  }

  useEffect(() => {
    if (address) void reloadOffers();
    else setOffers([]);
  }, [address]);

  async function publishOffer(event: FormEvent) {
    event.preventDefault();
    if (busy || polling) return;
    const issues = validateMembershipOffer(priceKas, description);
    if (issues.length) {
      setFailure({ code: null, message: issues.join(" ") });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      if (!address) {
        if (!(await signIn())) return;
      }
      const payoutPk = await getWalletPublicKey();
      setStatus(COPY.offeringDeploy);
      const proposed = await api<MembershipDeployResponse>(
        "/api/membership/offers/propose",
        {
          method: "POST",
          body: JSON.stringify({ price: priceKas, description, payoutPk }),
        },
      );
      setDeploy(proposed);
      if (proposed.state === "CONFIRMED") {
        setStatus(COPY.offerLive);
        await reloadOffers();
        return;
      }
      setStatus(COPY.offerSignPrompt);
      const signedTransaction = await signPreparedPayment(
        proposed.transaction!,
      );
      setStatus(COPY.offeringDeploy);
      const finalized = await api<MembershipDeployResponse>(
        `/api/membership/deploys/${proposed.id}/finalize`,
        {
          method: "POST",
          body: JSON.stringify({ signedTransaction }),
        },
      );
      setDeploy(finalized);
      if (finalized.state === "CONFIRMED") {
        setStatus(COPY.offerLive);
        await reloadOffers();
      } else if (finalized.state === "PENDING") {
        setStatus(COPY.offerDeployPending);
      } else {
        setStatus(finalized.rejection ?? COPY.offerPublishFailed);
      }
    } catch (caught) {
      const apiFailure = caught instanceof ApiError ? caught : null;
      setFailure({
        code: apiFailure?.code ?? null,
        message: caught instanceof Error ? caught.message : COPY.offerPublishFailed,
      });
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  const offerActive = offers.some((offer) => offer.isActive);
  const actionLabel = polling
    ? COPY.offerDeployPending
    : busy
      ? signingIn
        ? "Signing in..."
        : COPY.offerSigning
      : "Publish offer";

  return (
    <section className="publish-card">
      <header className="publish-intro">
        <h1>{COPY.offerMembershipTitle}</h1>
        <p>{COPY.offerMembershipIntro}</p>
      </header>
      {offerActive ? (
        <div className="feedback success" aria-live="polite">
          {COPY.offerLive}
        </div>
      ) : null}
      <form onSubmit={(event) => void publishOffer(event)}>
        <div className="publish-controls">
          <div className="publish-details">
            <label className="price-field">
              Price
              <span className="unit">
                <KaspaMark />
                <span className="sr-only">KAS</span>
              </span>
              <input
                inputMode="decimal"
                value={priceKas}
                disabled={busy || polling}
                onChange={(event) => setPriceKas(event.target.value)}
              />
            </label>
            <label>
              {COPY.offerDescriptionLabel}
              <textarea
                value={description}
                maxLength={280}
                disabled={busy || polling}
                placeholder={COPY.offerDescriptionHint}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <p className="permanence-note">{COPY.offerMembershipPermanence}</p>
          </div>

          <div
            aria-live="polite"
            className={failure ? "feedback error" : "feedback"}
          >
            {failure?.message ?? status}
          </div>
          <button
            className="primary publish-action"
            disabled={busy || polling}
          >
            {actionLabel}
          </button>
        </div>
      </form>

      {offers.length > 0 && (
        <ul className="offer-list">
          {offers.map((offer) => (
            <li key={offer.id}>
              <span className="offer-price">
                <KaspaMark />
                {Number(offer.priceSompi) / 100_000_000} KAS
              </span>
              <span className="offer-description">{offer.description}</span>
              <code className="offer-covenant">{offer.covenantId}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}