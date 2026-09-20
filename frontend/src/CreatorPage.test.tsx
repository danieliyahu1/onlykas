import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CreatorPage } from "./CreatorPage.js";
import { shortenAddress } from "./format.js";
import { api, signPreparedPayment } from "./kasware.js";
import {
  creator,
  creatorAddress,
  consumerAddress,
  post,
  unnamedCreator,
} from "./test-fixtures.js";

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
  signPreparedPayment: vi.fn(),
}));

function renderCreator(
  address: string | null,
  signIn = vi.fn(async () => address),
  onVisibilityChange?: (isPublic: boolean) => Promise<unknown>,
) {
  render(
    <MemoryRouter initialEntries={[`/creator/${creatorAddress}`]}>
      <Routes>
        <Route
          path="/creator/:address"
          element={
            <CreatorPage
              address={address}
              signIn={signIn}
              signingIn={false}
              {...(onVisibilityChange ? { onVisibilityChange } : {})}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CreatorPage subscription actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the authenticated profile owner start a subscription", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(creator(true, false))
      .mockResolvedValueOnce({ id: "offer", transaction: "{}", signInputs: [0] })
      .mockResolvedValueOnce({ state: "CONFIRMED" })
      .mockResolvedValueOnce(creator(true, true));
    vi.mocked(signPreparedPayment).mockResolvedValue("signed");
    const user = userEvent.setup();
    renderCreator(creatorAddress);

    await user.click(await screen.findByRole("button", { name: "Start subscription" }));

    expect(api).toHaveBeenCalledWith("/api/membership/offers/prepare", {
      method: "POST",
      body: JSON.stringify({ price: "10" }),
    });
    expect(signPreparedPayment).toHaveBeenCalledWith("{}", [0]);
    expect(api).toHaveBeenCalledWith("/api/membership/offers/offer/finalize", {
      method: "POST",
      body: JSON.stringify({ signedTransaction: "signed" }),
    });
    expect(await screen.findByText("Subscription is ready.")).toBeVisible();
  });

  it("lets a consumer subscribe from the creator profile", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(creator(false, true))
      .mockResolvedValueOnce({ id: "purchase", transaction: "{}", signInputs: [1] })
      .mockResolvedValueOnce({ state: "CONFIRMED" })
      .mockResolvedValueOnce(creator(false, true, true));
    vi.mocked(signPreparedPayment).mockResolvedValue("signed");
    const user = userEvent.setup();
    renderCreator(consumerAddress);

    await user.click(await screen.findByRole("button", { name: "Subscribe" }));

    expect(api).toHaveBeenCalledWith(
      `/api/membership/${encodeURIComponent(creatorAddress)}/prepare`,
      { method: "POST" },
    );
    expect(signPreparedPayment).toHaveBeenCalledWith("{}", [1]);
    await waitFor(() => expect(screen.getByText("Subscribed")).toBeVisible());
  });

  it("shows preparing before wallet approval and confirming after", async () => {
    let resolveSign!: (value: string) => void;
    const sign = new Promise<string>((resolve) => {
      resolveSign = resolve;
    });
    let resolveFinalize!: (value: { state: string }) => void;
    const finalize = new Promise<{ state: string }>((resolve) => {
      resolveFinalize = resolve;
    });
    vi.mocked(api)
      .mockResolvedValueOnce(creator(false, true))
      .mockResolvedValueOnce({ id: "purchase", transaction: "{}", signInputs: [1] })
      .mockImplementationOnce(() => finalize)
      .mockResolvedValueOnce(creator(false, true, true));
    vi.mocked(signPreparedPayment).mockImplementationOnce(() => sign);
    const user = userEvent.setup();
    renderCreator(consumerAddress);

    await user.click(await screen.findByRole("button", { name: "Subscribe" }));

    expect(await screen.findByRole("button", { name: "Preparing..." })).toBeDisabled();

    resolveSign("signed");
    expect(await screen.findByRole("button", { name: "Confirming..." })).toBeDisabled();

    resolveFinalize({ state: "CONFIRMED" });
    await waitFor(() => expect(screen.getByText("Subscribed")).toBeVisible());
  });

  it("uses the wallet address as identity when the creator has no name", async () => {
    vi.mocked(api).mockResolvedValueOnce(unnamedCreator());
    renderCreator(null);

    expect(
      await screen.findByRole("heading", { name: shortenAddress(creatorAddress) }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy Kaspa address" })).toBeVisible();
  });

  it("shows locked posts with an unlock action and unlocked posts with a watch link", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(false, true),
      posts: [
        post("locked-post", "Locked one", false),
        post("open-post", "Open one", true),
      ],
    });
    renderCreator(null);

    expect(await screen.findByRole("button", { name: /unlock/i })).toBeVisible();
    expect(screen.getByText("Locked one")).toBeVisible();
    expect(screen.getByText("Open one")).toBeVisible();
    expect(screen.getByRole("link", { name: /watch/i })).toHaveAttribute(
      "href",
      "/post/open-post",
    );
  });

  it("links each post's media to the post page", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(false, true),
      posts: [
        post("locked-post", "Locked one", false),
        post("open-post", "Open one", true),
      ],
    });
    renderCreator(null);

    const mediaLinks = await screen.findAllByRole("link", { name: "Open post" });
    expect(mediaLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/post/locked-post",
      "/post/open-post",
    ]);
  });

  it("buys a locked post directly from the profile card", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        ...creator(false, true),
        posts: [post("locked-post", "Locked one", false)],
      })
      .mockResolvedValueOnce({ id: "pay-1", transaction: "{}" })
      .mockResolvedValueOnce({ state: "CONFIRMED", message: "Unlocked." });
    vi.mocked(signPreparedPayment).mockResolvedValue("signed");
    const user = userEvent.setup();
    renderCreator(consumerAddress);

    await user.click(await screen.findByRole("button", { name: /unlock/i }));

    expect(api).toHaveBeenCalledWith("/api/posts/locked-post/payments/prepare", {
      method: "POST",
    });
    expect(signPreparedPayment).toHaveBeenCalledWith("{}");
    expect(api).toHaveBeenCalledWith("/api/payments/pay-1/finalize", {
      method: "POST",
      body: JSON.stringify({ signedTransaction: "signed" }),
    });
    expect(await screen.findByRole("link", { name: /watch/i })).toHaveAttribute(
      "href",
      "/post/locked-post",
    );
    expect(screen.getByText("Unlocked.")).toBeVisible();
  });

  it("refreshes after the viewer signs in without a page refresh", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(creator(false, true, false))
      .mockResolvedValueOnce(creator(false, true, true));
    const view = render(
      <MemoryRouter initialEntries={[`/creator/${creatorAddress}`]}>
        <Routes>
          <Route
            path="/creator/:address"
            element={
              <CreatorPage
                address={null}
                signIn={vi.fn(async () => consumerAddress)}
                signingIn={false}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Subscribe" })).toBeVisible();

    view.rerender(
      <MemoryRouter initialEntries={[`/creator/${creatorAddress}`]}>
        <Routes>
          <Route
            path="/creator/:address"
            element={
              <CreatorPage
                address={consumerAddress}
                signIn={vi.fn(async () => consumerAddress)}
                signingIn={false}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Subscribed")).toBeVisible();
    expect(api).toHaveBeenCalledTimes(2);
  });
});

describe("CreatorPage profile visibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the owner make their profile public", async () => {
    vi.mocked(api).mockResolvedValueOnce(creator(true, false));
    const onVisibilityChange = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderCreator(
      creatorAddress,
      vi.fn(async () => creatorAddress),
      onVisibilityChange,
    );

    await user.click(await screen.findByRole("button", { name: "Change" }));

    expect(onVisibilityChange).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Profile is public.")).toBeVisible();
  });

  it("refuses the visibility toggle to visitors and consumers", async () => {
    vi.mocked(api).mockResolvedValueOnce(creator(false, false));
    renderCreator(consumerAddress);

    expect(await screen.findByRole("heading", { name: "Creator" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  });

  it("shows the current public state on the owner profile", async () => {
    vi.mocked(api).mockResolvedValueOnce({ ...creator(true, false), isPublic: true });
    renderCreator(
      creatorAddress,
      vi.fn(async () => creatorAddress),
      vi.fn(async () => undefined),
    );

    expect(await screen.findByText("Visibility: Public")).toBeVisible();
    expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
  });

  it("lets the owner make their public profile private again", async () => {
    vi.mocked(api).mockResolvedValueOnce({ ...creator(true, false), isPublic: true });
    const onVisibilityChange = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderCreator(
      creatorAddress,
      vi.fn(async () => creatorAddress),
      onVisibilityChange,
    );

    await user.click(await screen.findByRole("button", { name: "Change" }));

    expect(onVisibilityChange).toHaveBeenCalledWith(false);
    expect(await screen.findByText("Profile is private.")).toBeVisible();
  });

  it("keeps the previous state when saving visibility fails", async () => {
    vi.mocked(api).mockResolvedValueOnce(creator(true, false));
    const onVisibilityChange = vi.fn(async () => {
      throw new Error("Save failed");
    });
    const user = userEvent.setup();
    renderCreator(
      creatorAddress,
      vi.fn(async () => creatorAddress),
      onVisibilityChange,
    );

    await user.click(await screen.findByRole("button", { name: "Change" }));

    expect(onVisibilityChange).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Save failed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
    expect(screen.queryByText("Visibility: Public")).not.toBeInTheDocument();
  });
});

describe("CreatorPage post deletion", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("lets the owner delete a post after confirming", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(true, false),
      posts: [post("own-post", "My moment", true)],
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderCreator(creatorAddress);

    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(confirm).toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith("/api/posts/own-post", { method: "DELETE" });
    expect(await screen.findByText("Post deleted.")).toBeVisible();
    expect(screen.queryByText("My moment")).not.toBeInTheDocument();
  });

  it("keeps the post when the owner cancels the confirmation", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(true, false),
      posts: [post("own-post", "My moment", true)],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderCreator(creatorAddress);

    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(api).toHaveBeenCalledTimes(1);
    expect(screen.getByText("My moment")).toBeVisible();
  });

  it("hides the delete action from visitors", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(false, true),
      posts: [post("own-post", "My moment", true)],
    });
    renderCreator(consumerAddress);

    expect(await screen.findByText("My moment")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });
});
