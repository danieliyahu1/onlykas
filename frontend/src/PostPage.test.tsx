import { StrictMode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PostResponse } from "@onlykas/shared";
import { COPY } from "./copy.js";
import { PostPage } from "./PostPage.js";
import { api, ApiError, signPreparedPayment } from "./kasware.js";
import { consumerAddress, post } from "./test-fixtures.js";

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
  signPreparedPayment: vi.fn(),
}));

function renderPost(result: PostResponse, address: string | null = null) {
  render(
    <MemoryRouter initialEntries={[`/post/${result.id}`]}>
      <Routes>
        <Route
          path="/post/:id"
          element={
            <PostPage
              address={address}
              signIn={vi.fn(async () => address)}
              signingIn={false}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PostPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders an OnlyKas video player for an unlocked video", async () => {
    const videoPost = post("video-post", "A moment for the circle", true);
    vi.mocked(api).mockResolvedValueOnce({ ...videoPost, mediaType: "video/mp4" });
    renderPost(videoPost);

    const player = await screen.findByRole("group", {
      name: "A moment for the circle video",
    });
    const video = player.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("playsinline");
    expect(
      screen.queryByRole("button", { name: /play video/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fullscreen video" })).toBeVisible();
  });

  it("blocks the buyer until the payment response arrives", async () => {
    let resolveFinalize!: (value: { state: string; message?: string }) => void;
    const finalize = new Promise<{ state: string; message?: string }>((resolve) => {
      resolveFinalize = resolve;
    });
    vi.mocked(api)
      .mockResolvedValueOnce(post("paid-post", "A paid moment", false))
      .mockResolvedValueOnce({ id: "pay-1", transaction: "{}" })
      .mockImplementationOnce(() => finalize);
    vi.mocked(signPreparedPayment).mockResolvedValue("signed");
    renderPost(post("paid-post", "A paid moment", false), consumerAddress);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /unlock for/i }));

    expect(await screen.findByRole("button", { name: "Unlocking..." })).toBeDisabled();
    expect(
      screen.queryByRole("img", { name: "A paid moment" }),
    ).not.toBeInTheDocument();

    resolveFinalize({ state: "CONFIRMED", message: "Unlocked." });
    expect(await screen.findByRole("img", { name: "A paid moment" })).toBeVisible();
    expect(screen.getByText("Unlocked.")).toBeVisible();
    expect(api).toHaveBeenCalledTimes(3);
  });

  it("shows unlocking only after wallet approval", async () => {
    let resolveSign!: (value: string) => void;
    const signing = new Promise<string>((resolve) => {
      resolveSign = resolve;
    });
    vi.mocked(api)
      .mockResolvedValueOnce(post("approval-post", "A paid moment", false))
      .mockResolvedValueOnce({ id: "pay-1", transaction: "{}" })
      .mockImplementationOnce(() => new Promise(() => undefined));
    vi.mocked(signPreparedPayment).mockReturnValueOnce(signing);
    renderPost(post("approval-post", "A paid moment", false), consumerAddress);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /unlock for/i }));

    expect(await screen.findByRole("button", { name: "Approve in wallet..." })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Unlocking..." })).not.toBeInTheDocument();

    resolveSign("signed");
    expect(await screen.findByRole("button", { name: "Unlocking..." })).toBeDisabled();
  });

  it("tells the buyer when the payment is still confirming", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(post("paid-post", "A paid moment", false))
      .mockResolvedValueOnce({ id: "pay-1", transaction: "{}" })
      .mockResolvedValueOnce({ state: "PENDING", message: "Purchase pending." });
    vi.mocked(signPreparedPayment).mockResolvedValue("signed");
    renderPost(post("paid-post", "A paid moment", false), consumerAddress);
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

    expect(await screen.findByRole("heading", { name: COPY.serverDown })).toBeVisible();
  });

  it("shows loading instead of unavailable while the post is being fetched", () => {
    vi.mocked(api).mockImplementationOnce(
      () => new Promise<PostResponse>(() => undefined),
    );
    renderPost(post("pending-post", "A pending moment", false));

    expect(screen.getByRole("heading", { name: "Loading..." })).toBeVisible();
    expect(screen.queryByText("This post isn't available.")).not.toBeInTheDocument();
  });

  it("renders media for a free post to a signed-out viewer", async () => {
    const free = { ...post("free-post", "A free moment", true), priceSompi: "0" };
    vi.mocked(api).mockResolvedValueOnce(free);
    renderPost(free);

    expect(await screen.findByRole("img", { name: "A free moment" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sign in to view" }),
    ).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("refetches access after the viewer signs in without a page refresh", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(post("auth-post", "A private moment", false))
      .mockResolvedValueOnce(post("auth-post", "A private moment", true));
    const view = render(
      <MemoryRouter initialEntries={["/post/auth-post"]}>
        <Routes>
          <Route
            path="/post/:id"
            element={
              <PostPage
                address={null}
                signIn={vi.fn(async () => consumerAddress)}
                signingIn={false}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: /unlock for/i })).toBeVisible();

    view.rerender(
      <MemoryRouter initialEntries={["/post/auth-post"]}>
        <Routes>
          <Route
            path="/post/:id"
            element={
              <PostPage
                address={consumerAddress}
                signIn={vi.fn(async () => consumerAddress)}
                signingIn={false}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("img", { name: "A private moment" })).toBeVisible();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("refetches access when the tab regains focus", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(post("focus-post", "A private moment", false))
      .mockResolvedValueOnce(post("focus-post", "A private moment", true));
    renderPost(post("focus-post", "A private moment", false), consumerAddress);

    expect(await screen.findByRole("button", { name: /unlock for/i })).toBeVisible();

    fireEvent.focus(window);

    expect(await screen.findByRole("img", { name: "A private moment" })).toBeVisible();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("shows a notice passed through navigation", async () => {
    vi.mocked(api).mockResolvedValue(post("notice-post", "A notice", true));
    render(
      <StrictMode>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/post/notice-post",
              state: { notice: COPY.mediaAlreadyPublished },
            },
          ]}
        >
          <Routes>
            <Route
              path="/post/:id"
              element={
                <PostPage address={null} signIn={vi.fn(async () => null)} signingIn={false} />
              }
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      COPY.mediaAlreadyPublished,
    );
    expect(screen.getByRole("status")).toHaveClass("toast-notice");
  });
});
