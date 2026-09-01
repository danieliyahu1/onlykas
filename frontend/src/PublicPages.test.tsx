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
  description: "A private image",
  priceSompi: "125000000",
  mediaType: "image/png" as const,
  publishedAt: "2026-01-01T00:00:00.000Z",
  canView: false,
};

function renderPost() {
  return render(
    <MemoryRouter initialEntries={["/post/post-1"]}>
      <Routes>
        <Route
          path="/post/:id"
          element={
            <PostPage address={address} signIn={vi.fn()} signingIn={false} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderCreator(address = post.creator) {
  return render(
    <MemoryRouter initialEntries={[`/creator/${address}`]}>
      <Routes>
        <Route path="/creator/:address" element={<CreatorPage />} />
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
  vi.clearAllMocks();
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

    await user.click(
      await screen.findByRole("button", { name: /unlock for/i }),
    );
    await user.click(await screen.findByRole("button", { name: /pay/i }));
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
    await user.click(
      await screen.findByRole("button", { name: /unlock for/i }),
    );
    await user.click(await screen.findByRole("button", { name: /pay/i }));
    expect(await screen.findByText(COPY.purchasePending)).toBeVisible();
    expect(screen.getByRole("button", { name: "Pending" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Retry payment" }),
    ).not.toBeInTheDocument();
  });

  it("offers retry only after rejection and prepares a new attempt", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(post)
      .mockResolvedValueOnce(prepareResponse())
      .mockRejectedValueOnce(new Error(COPY.transactionRejected))
      .mockResolvedValueOnce({ ...prepareResponse(), id: "payment-2" });
    const user = userEvent.setup();
    renderPost();
    await user.click(
      await screen.findByRole("button", { name: /unlock for/i }),
    );
    expect(
      screen.queryByRole("button", { name: "Retry payment" }),
    ).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /pay/i }));
    expect(await screen.findByText(COPY.transactionRejected)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry payment" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        `/api/posts/${post.id}/payments/prepare`,
        { method: "POST" },
      ),
    );
    expect(signPreparedPayment).toHaveBeenCalledOnce();
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
    expect(screen.getByRole("button", { name: "Pending" })).toBeDisabled();
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
      "Creator not found.",
    );
  });
});
