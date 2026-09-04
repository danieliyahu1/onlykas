import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { COPY } from "@onlykas/shared";
import { CreatorPage, PostPage } from "./PublicPages.js";
import { api, signPreparedPayment } from "./kasware.js";

vi.mock("./kasware.js", () => ({
  api: vi.fn(),
  signPreparedPayment: vi.fn(),
  WalletError: class WalletError extends Error {},
}));

const address = `kaspatest:${"q".repeat(60)}`;
const post = {
  id: "post-1",
  creator: `kaspatest:${"c".repeat(60)}`,
  title: "First light",
  caption: "A private image",
  priceSompi: "125000000",
  mediaType: "image/png" as const,
  publishedAt: "2026-01-01T00:00:00.000Z",
  canView: false,
};

function renderPost({
  currentAddress = address,
  signIn = vi.fn(async () => address),
}: {
  currentAddress?: string | null;
  signIn?: () => Promise<string | null>;
} = {}) {
  return render(
    <MemoryRouter initialEntries={["/post/post-1"]}>
      <Routes>
        <Route
          path="/post/:id"
          element={
            <PostPage
              address={currentAddress}
              signIn={signIn}
              signingIn={false}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderCreator(
  address = post.creator,
  {
    wallet = null,
    signIn = vi.fn(async () => address),
  }: {
    wallet?: string | null;
    signIn?: () => Promise<string | null>;
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={[`/creator/${address}`]}>
      <Routes>
        <Route
          path="/creator/:address"
          element={
            <CreatorPage wallet={wallet} signIn={signIn} signingIn={false} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function prepareResponse() {
  return {
    id: "payment-1",
    transaction: '{"inputs":[]}',
    amountSompi: post.priceSompi,
  };
}

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(signPreparedPayment).mockReset();
  window.localStorage.clear();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === `/api/posts/${post.id}`) return post;
    throw new Error("unexpected request");
  });
  vi.mocked(signPreparedPayment).mockResolvedValue("signed");
});

describe("supporter payment branches", () => {
  it("confirms payment and reveals the media immediately", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(post)
      .mockResolvedValueOnce(prepareResponse())
      .mockResolvedValueOnce({ state: "CONFIRMED", message: COPY.unlocked });
    const user = userEvent.setup();
    renderPost();

    await user.click(await screen.findByRole("button", { name: /view for/i }));
    expect(await screen.findByText(COPY.unlocked)).toBeVisible();
    expect(screen.getByRole("img", { name: post.title })).toBeVisible();
  });

  it("keeps pending payments safe and does not offer payment again", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(post)
      .mockResolvedValueOnce(prepareResponse())
      .mockRejectedValueOnce(new Error(COPY.purchasePending));
    const user = userEvent.setup();
    renderPost();
    await user.click(await screen.findByRole("button", { name: /view for/i }));
    expect(await screen.findByText(COPY.purchasePending)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Payment confirming..." }),
    ).toBeDisabled();
  });

  it("offers retry only after rejection and prepares a new attempt", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(post)
      .mockResolvedValueOnce(prepareResponse())
      .mockRejectedValueOnce(new Error(COPY.transactionRejected))
      .mockResolvedValueOnce({ ...prepareResponse(), id: "payment-2" })
      .mockResolvedValueOnce({ state: "CONFIRMED", message: COPY.unlocked });
    const user = userEvent.setup();
    renderPost();
    await user.click(await screen.findByRole("button", { name: /view for/i }));
    expect(await screen.findByText(COPY.transactionRejected)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        `/api/posts/${post.id}/payments/prepare`,
        { method: "POST" },
      ),
    );
    expect(signPreparedPayment).toHaveBeenCalledTimes(2);
  });

  it("recovers a pending attempt after reload", async () => {
    window.localStorage.setItem(
      `onlykas:payment:${post.id}:${address}`,
      "payment-1",
    );
    vi.mocked(api).mockResolvedValueOnce(post).mockResolvedValueOnce({
      id: "payment-1",
      state: "PENDING",
      amountSompi: post.priceSompi,
    });
    renderPost();
    expect(await screen.findByText(COPY.purchasePending)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Payment confirming..." }),
    ).toBeDisabled();
  });

  it("continues the requested view after sign-in", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(post)
      .mockResolvedValueOnce(prepareResponse())
      .mockResolvedValueOnce({ state: "CONFIRMED", message: COPY.unlocked });
    const signIn = vi.fn(async () => address);
    const user = userEvent.setup();
    renderPost({ currentAddress: null, signIn });

    await user.click(await screen.findByRole("button", { name: /view for/i }));

    expect(signIn).toHaveBeenCalledOnce();
    expect(await screen.findByRole("img", { name: post.title })).toBeVisible();
  });

  it("does not prepare payment after cancelled sign-in", async () => {
    const signIn = vi.fn(async () => null);
    const user = userEvent.setup();
    renderPost({ currentAddress: null, signIn });

    await user.click(await screen.findByRole("button", { name: /view for/i }));

    expect(signIn).toHaveBeenCalledOnce();
    expect(api).toHaveBeenCalledTimes(1);
    expect(signPreparedPayment).not.toHaveBeenCalled();
  });

  it("renders a media recovery message when the purchased media fails", async () => {
    vi.mocked(api).mockResolvedValue({ ...post, canView: true });
    renderPost();
    const image = await screen.findByRole("img", { name: post.title });
    fireEvent.error(image);
    expect(screen.getByRole("alert")).toHaveTextContent(COPY.mediaUnavailable);
  });
});

describe("public creator profiles", () => {
  it("renders an empty profile as a status for visitors without a wallet", async () => {
    vi.mocked(api).mockResolvedValue({
      address: post.creator,
      displayAddress: "kaspatest:cccc...cccc",
      displayName: null,
      posts: [],
    });
    renderCreator();

    expect(await screen.findByText("Nothing published yet.")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("renders a failed profile load as an alert", async () => {
    vi.mocked(api).mockRejectedValue(new Error("not found"));
    renderCreator();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Profile not found.",
    );
  });
});

describe("membership panel on creator profiles", () => {
  const offer = {
    id: "offer-1",
    creator: post.creator,
    covenantId: "covenant-1",
    priceSompi: "125000000",
    description: "A day of access",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const membership = {
    id: "membership-1",
    offerId: "offer-1",
    owner: address,
    creator: post.creator,
    covenantId: "covenant-1",
    createdTxId: "tx-1",
    createdAt: "2099-01-01T00:00:00.000Z",
    validUntil: "2099-01-02T00:00:00.000Z",
    state: "ACTIVE" as const,
  };
  const preparedMint = {
    id: "mint-1",
    offerId: "offer-1",
    creator: post.creator,
    covenantId: "covenant-1",
    priceSompi: "125000000",
    state: "PREPARED" as const,
    transaction: '{"inputs":[]}',
    fingerprint: "fingerprint",
    transactionId: null,
    rejection: null,
    submittedAt: null,
    lastCheckedAt: null,
    reconciliationAttempts: 0,
    membership: null,
  };

  function creatorApi() {
    const encodedCreator = encodeURIComponent(post.creator);
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === `/api/creators/${encodedCreator}`)
        return {
          address: post.creator,
          displayAddress: "kaspatest:cccc...cccc",
          displayName: null,
          posts: [],
        };
      if (path === `/api/membership/offers/${encodedCreator}`)
        return { offer };
      if (path === `/api/membership/offers/${offer.id}/memberships`)
        return { memberships: [membership] };
      throw new Error(`unexpected request: ${path}`);
    });
  }

  it("offers membership and a supporter becomes a member", async () => {
    const signIn = vi.fn(async () => address);
    creatorApi();
    vi.mocked(api)
      .mockResolvedValueOnce({
        address: post.creator,
        displayAddress: "kaspatest:cccc...cccc",
        displayName: null,
        posts: [],
      })
      .mockResolvedValueOnce({ offer })
      .mockResolvedValueOnce(preparedMint)
      .mockResolvedValueOnce({
        ...preparedMint,
        state: "CONFIRMED",
        transactionId: "signed",
        membership,
      });
    const user = userEvent.setup();
    renderCreator(post.creator, { wallet: null, signIn });

    expect(await screen.findByText("A day of access")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /become a member for 1.25/i }),
    );

    expect(signIn).toHaveBeenCalledOnce();
    expect(api).toHaveBeenCalledWith(
      `/api/membership/offers/${offer.id}/mints/propose`,
      { method: "POST" },
    );
    expect(api).toHaveBeenCalledWith(
      `/api/membership/mints/mint-1/finalize`,
      { method: "POST", body: JSON.stringify({ signedTransaction: "signed" }) },
    );
    expect(await screen.findByText(COPY.membershipLive)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /become a member for 1.25/i }),
    ).toBeVisible();
  });

  it("shows the active membership of a signed-in supporter", async () => {
    creatorApi();
    renderCreator(post.creator, { wallet: address });

    expect(
      await screen.findByText(/You're a member\. Active until/i),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /renew for 1.25/i })).toBeVisible();
  });

  it("recovers a pending membership attempt after reload", async () => {
    window.localStorage.setItem(
      `onlykas:mint:${offer.id}:${address}`,
      "mint-1",
    );
    vi.mocked(api).mockImplementation(async (path) => {
      const encodedCreator = encodeURIComponent(post.creator);
      if (path === `/api/creators/${encodedCreator}`)
        return {
          address: post.creator,
          displayAddress: "kaspatest:cccc...cccc",
          displayName: null,
          posts: [],
        };
      if (path === `/api/membership/offers/${encodedCreator}`) return { offer };
      if (path === `/api/membership/mints/mint-1`)
        return {
          ...preparedMint,
          state: "PENDING",
          transactionId: "signed",
        };
      if (path === `/api/membership/offers/${offer.id}/memberships`)
        return { memberships: [] };
      throw new Error(`unexpected request: ${path}`);
    });
    renderCreator(post.creator, { wallet: address });

    const pendingButton = await screen.findByRole("button", {
      name: COPY.membershipPending,
    });
    expect(pendingButton).toBeDisabled();
  });
});
