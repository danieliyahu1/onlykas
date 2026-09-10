import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CreatorResponse, PostResponse } from "@onlykas/shared";
import { COPY } from "@onlykas/shared";
import { CreatorPage, PostPage } from "./PublicPages.js";
import { api, ApiError, signPreparedPayment } from "./kasware.js";

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
  signPreparedPayment: vi.fn(),
}));

const creatorAddress = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const consumerAddress = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";

function creator(isOwner: boolean, offered: boolean, active = false): CreatorResponse {
  return {
    address: creatorAddress,
    displayAddress: creatorAddress,
    displayName: "Creator",
    isOwner,
    membership: { offered, active },
    posts: [],
  };
}

function unnamedCreator(): CreatorResponse {
  return {
    ...creator(false, false),
    displayName: null,
  };
}

function renderProfile(address: string | null, signIn = vi.fn(async () => address)) {
  render(
    <MemoryRouter initialEntries={[`/creator/${creatorAddress}`]}>
      <Routes>
        <Route path="/creator/:address" element={<CreatorPage address={address} signIn={signIn} signingIn={false} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("creator membership actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the authenticated profile owner create an offer", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(creator(true, false))
      .mockResolvedValueOnce({ id: "offer", transaction: "{}", signInputs: [0] })
      .mockResolvedValueOnce({ state: "CONFIRMED" })
      .mockResolvedValueOnce(creator(true, true));
    vi.mocked(signPreparedPayment).mockResolvedValue("signed");
    const user = userEvent.setup();
    renderProfile(creatorAddress);

    await user.click(await screen.findByRole("button", { name: "Open access" }));

    expect(api).toHaveBeenCalledWith("/api/membership/offers/prepare", { method: "POST" });
    expect(signPreparedPayment).toHaveBeenCalledWith("{}", [0]);
    expect(api).toHaveBeenCalledWith("/api/membership/offers/offer/finalize", {
      method: "POST",
      body: JSON.stringify({ signedTransaction: "signed" }),
    });
    expect(await screen.findByText("Membership offer created.")).toBeVisible();
  });

  it("lets a consumer subscribe from the creator profile", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(creator(false, true))
      .mockResolvedValueOnce({ id: "purchase", transaction: "{}", signInputs: [1] })
      .mockResolvedValueOnce({ state: "CONFIRMED" })
      .mockResolvedValueOnce(creator(false, true, true));
    vi.mocked(signPreparedPayment).mockResolvedValue("signed");
    const user = userEvent.setup();
    renderProfile(consumerAddress);

    await user.click(await screen.findByRole("button", { name: "Unlock all" }));

    expect(api).toHaveBeenCalledWith(`/api/membership/${encodeURIComponent(creatorAddress)}/prepare`, { method: "POST" });
    expect(signPreparedPayment).toHaveBeenCalledWith("{}", [1]);
    await waitFor(() => expect(screen.getByText("Subscribed")).toBeVisible());
  });

  it("uses the wallet address as identity when the creator has no name", async () => {
    vi.mocked(api).mockResolvedValueOnce(unnamedCreator());
    renderProfile(null);

    expect(await screen.findByRole("heading", { name: shorten(creatorAddress) })).toBeVisible();
    expect(screen.getByRole("button", { name: shorten(creatorAddress) })).toBeVisible();
  });

  it("shows a lock state for every post on the creator profile", async () => {
    const locked = post("locked-post", "Locked one", false);
    const open = post("open-post", "Open one", true);
    vi.mocked(api).mockResolvedValueOnce({ ...creator(false, true), posts: [locked, open] });
    renderProfile(null);

    expect(await screen.findByText("Locked")).toBeVisible();
    expect(screen.getByText("Unlocked")).toBeVisible();
    expect(screen.getByText("Locked one")).toBeVisible();
    expect(screen.getByText("Open one")).toBeVisible();
  });

  it("renders an OnlyKas video player for an unlocked video", async () => {
    const post: PostResponse = {
      id: "video-post",
      creator: creatorAddress,
      caption: "A moment for the circle",
      priceSompi: "100000000",
      mediaType: "video/mp4",
      publishedAt: "2026-09-10T00:00:00.000Z",
      canView: true,
    };
    vi.mocked(api).mockResolvedValueOnce(post);
    renderPost(post);

    const player = await screen.findByRole("group", { name: "A moment for the circle video" });
    const video = player.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("playsinline");
    expect(screen.getAllByRole("button", { name: "Play video" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Fullscreen video" })).toBeVisible();
  });

  it("blocks the buyer until the payment response arrives", async () => {
    const locked = post("paid-post", "A paid moment", false);
    let resolveFinalize!: (value: { state: string; message?: string }) => void;
    const finalize = new Promise<{ state: string; message?: string }>((resolve) => { resolveFinalize = resolve; });
    vi.mocked(api)
      .mockResolvedValueOnce(locked)
      .mockResolvedValueOnce({ id: "pay-1", transaction: "{}" })
      .mockImplementationOnce(() => finalize);
    vi.mocked(signPreparedPayment).mockResolvedValue("signed");
    render(
      <MemoryRouter initialEntries={["/post/paid-post"]}>
        <Routes>
          <Route path="/post/:id" element={<PostPage address={consumerAddress} signIn={vi.fn(async () => consumerAddress)} signingIn={false} />} />
        </Routes>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /unlock for/i }));

    expect(await screen.findByRole("button", { name: /working/i })).toBeDisabled();
    expect(screen.queryByRole("img", { name: "A paid moment" })).not.toBeInTheDocument();

    resolveFinalize({ state: "CONFIRMED", message: "Unlocked." });
    expect(await screen.findByRole("img", { name: "A paid moment" })).toBeVisible();
    expect(screen.getByText("Unlocked.")).toBeVisible();
    expect(api).toHaveBeenCalledTimes(3);
  });

  it("tells the buyer when the payment is still confirming", async () => {
    const locked = post("paid-post", "A paid moment", false);
    vi.mocked(api)
      .mockResolvedValueOnce(locked)
      .mockResolvedValueOnce({ id: "pay-1", transaction: "{}" })
      .mockResolvedValueOnce({ state: "PENDING", message: "Purchase pending." });
    vi.mocked(signPreparedPayment).mockResolvedValue("signed");
    render(
      <MemoryRouter initialEntries={["/post/paid-post"]}>
        <Routes>
          <Route path="/post/:id" element={<PostPage address={consumerAddress} signIn={vi.fn(async () => consumerAddress)} signingIn={false} />} />
        </Routes>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /unlock for/i }));

    expect(await screen.findByText("Purchase pending.")).toBeVisible();
    expect(api).toHaveBeenCalledTimes(3);
  });

  it("shows the server-down message when the post cannot be loaded", async () => {
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError("SERVER_UNAVAILABLE", COPY.serverDown, 0),
    );
    renderPost(post("paid-post", "A paid moment", false));

    expect(
      await screen.findByRole("heading", { name: COPY.serverDown }),
    ).toBeVisible();
  });
});

function shorten(address: string) {
  return `${address.slice(0, 16)}...${address.slice(-8)}`;
}

function post(id: string, caption: string, canView: boolean): PostResponse {
  return {
    id,
    creator: creatorAddress,
    caption,
    priceSompi: "100000000",
    mediaType: "image/jpeg",
    publishedAt: "2026-09-10T00:00:00.000Z",
    canView,
  };
}

function renderPost(post: PostResponse) {
  render(
    <MemoryRouter initialEntries={[`/post/${post.id}`]}>
      <Routes>
        <Route path="/post/:id" element={<PostPage address={null} signIn={vi.fn(async () => null)} signingIn={false} />} />
      </Routes>
    </MemoryRouter>,
  );
}
