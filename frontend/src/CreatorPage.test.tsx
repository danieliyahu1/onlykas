import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CreatorPage } from "./CreatorPage.js";
import { shortenAddress } from "./format.js";
import {
  ApiError,
  api,
  signPreparedPayment,
  WalletNetworkError,
} from "./kasware.js";
import { COPY } from "./copy.js";
import {
  creator,
  creatorAddress,
  consumerAddress,
  post,
  ToastSlot,
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
      <ToastSlot />
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
 
   it("stays quiet when the wallet needs a network switch", async () => {
     vi.mocked(api)
       .mockResolvedValueOnce(creator(false, true))
       .mockResolvedValueOnce({ id: "purchase", transaction: "{}", signInputs: [1] });
     vi.mocked(signPreparedPayment).mockRejectedValue(
       new WalletNetworkError(COPY.wrongNetwork),
     );
     const user = userEvent.setup();
     renderCreator(consumerAddress);

     await user.click(await screen.findByRole("button", { name: "Subscribe" }));

     expect(await screen.findByRole("button", { name: "Subscribe" })).toBeEnabled();
     expect(screen.queryByText(COPY.wrongNetwork)).not.toBeInTheDocument();
   });

   it("sends the price to the server and surfaces its rejection", async () => {
     vi.mocked(api)
       .mockResolvedValueOnce(creator(true, true))
       .mockRejectedValueOnce(
         new ApiError(
           "INVALID_MEMBERSHIP_PRICE",
           "Enter a monthly subscription price from 1 to 1,000,000 KAS.",
           400,
         ),
       );
     const user = userEvent.setup();
     renderCreator(creatorAddress);
 
     await user.click(await screen.findByRole("button", { name: "Update price" }));
     const field = screen.getByLabelText("Monthly subscription price in KAS");
     await user.clear(field);
     await user.type(field, "1,000");
     await user.click(screen.getByRole("button", { name: "Save price" }));
 
     expect(api).toHaveBeenCalledWith("/api/membership/price/prepare", {
       method: "POST",
       body: JSON.stringify({ price: "1,000" }),
     });
     expect(
       await screen.findByText(
         "Enter a monthly subscription price from 1 to 1,000,000 KAS.",
       ),
     ).toBeVisible();
   });
 
   it("refreshes and explains when the subscription moved", async () => {
     vi.mocked(api)
       .mockResolvedValueOnce(creator(true, true))
       .mockRejectedValueOnce(
         new ApiError(
           "MEMBERSHIP_OFFER_STALE",
           "This subscription changed. Submit again.",
           409,
           undefined,
           "AFTER_REFRESH",
         ),
       )
       .mockResolvedValueOnce(creator(true, true));
     const user = userEvent.setup();
     renderCreator(creatorAddress);
 
     await user.click(await screen.findByRole("button", { name: "Update price" }));
     await user.click(screen.getByRole("button", { name: "Save price" }));
 
     expect(
       await screen.findByText("This subscription changed. Submit again."),
     ).toBeVisible();
     await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
   });
 
   it("uses the wallet address as identity when the creator has no name", async () => {
    vi.mocked(api).mockResolvedValueOnce(unnamedCreator());
    renderCreator(null);

    expect(
      await screen.findByRole("heading", { name: shortenAddress(creatorAddress) }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy Kaspa address" })).toBeVisible();
  });

  it("shows locked posts with an unlock action and links captions to the post", async () => {
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
    expect(screen.getByRole("link", { name: "Open one" })).toHaveAttribute(
      "href",
      "/post/open-post",
    );
  });

  it("shows unlocked media inline and links only locked media to the post page", async () => {
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
    ]);
    expect(screen.getByRole("img", { name: "Open one" })).toHaveAttribute(
      "src",
      "/api/posts/open-post/media",
    );
  });

  it("marks each post with its media type", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(false, true),
      posts: [
        post("image-post", "A photo", true),
        { ...post("video-post", "A clip", true), mediaType: "video/mp4" },
      ],
    });
    renderCreator(null);

    expect(await screen.findByRole("link", { name: "Image" })).toHaveAttribute(
      "href",
      "/post/image-post",
    );
    expect(screen.getByRole("link", { name: "Video" })).toHaveAttribute(
      "href",
      "/post/video-post",
    );
  });

  it("plays a free video inline on the profile", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(false, true),
      posts: [
        {
          ...post("free-video", "A free clip", true),
          priceSompi: "0",
          mediaType: "video/mp4",
        },
      ],
    });
    renderCreator(null);

    const player = await screen.findByRole("group", { name: "A free clip video" });
    expect(player.querySelector("video")).toHaveAttribute(
      "src",
      "/api/posts/free-video/media",
    );
  });

  it("keeps a locked video behind a lock overlay", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(false, true),
      posts: [{ ...post("locked-video", "Locked clip", false), mediaType: "video/mp4" }],
    });
    renderCreator(null);

    expect(await screen.findByRole("link", { name: "Open post" })).toHaveAttribute(
      "href",
      "/post/locked-video",
    );
    expect(
      screen.queryByRole("group", { name: "Locked clip video" }),
    ).not.toBeInTheDocument();
  });

  it("shows the blurred preview behind the lock on a locked post card", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(false, true),
      posts: [post("locked-post", "Locked one", false)],
    });
    renderCreator(null);

    const link = await screen.findByRole("link", { name: "Open post" });
    expect(link.querySelector("img")).toHaveAttribute(
      "src",
      "/api/posts/locked-post/preview?v=8",
    );
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
    expect(screen.getByRole("link", { name: "Locked one" })).toHaveAttribute(
      "href",
      "/post/locked-post",
    );
    expect(screen.getByRole("img", { name: "Locked one" })).toHaveAttribute(
      "src",
      "/api/posts/locked-post/media",
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

  it("lets the owner make their private profile public", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(true, false),
      posts: [post("own-post", "My moment", true)],
    });
    const onVisibilityChange = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderCreator(
      creatorAddress,
      vi.fn(async () => creatorAddress),
      onVisibilityChange,
    );

    await user.click(await screen.findByRole("button", { name: "Private" }));

    expect(onVisibilityChange).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Profile is public.")).toBeVisible();
  });

  it("shows visitors the state without offering a toggle", async () => {
    vi.mocked(api).mockResolvedValueOnce(creator(false, false));
    renderCreator(consumerAddress);

    expect(await screen.findByText("Private")).toBeVisible();
    expect(screen.queryByTitle("Change visibility")).not.toBeInTheDocument();
  });

  it("shows the state to an owner without posts, without a toggle", async () => {
    vi.mocked(api).mockResolvedValueOnce(creator(true, false));
    renderCreator(
      creatorAddress,
      vi.fn(async () => creatorAddress),
      vi.fn(async () => undefined),
    );

    expect(await screen.findByText("Private")).toBeVisible();
    expect(screen.queryByTitle("Change visibility")).not.toBeInTheDocument();
  });

  it("shows the current public state with a toggle on the owner profile", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(true, false),
      isPublic: true,
      posts: [post("own-post", "My moment", true)],
    });
    renderCreator(
      creatorAddress,
      vi.fn(async () => creatorAddress),
      vi.fn(async () => undefined),
    );

    expect(await screen.findByText("Public")).toBeVisible();
    expect(screen.getByTitle("Change visibility")).toBeVisible();
  });

  it("lets the owner make their public profile private again", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(true, false),
      isPublic: true,
      posts: [post("own-post", "My moment", true)],
    });
    const onVisibilityChange = vi.fn(async () => undefined);
    const user = userEvent.setup();
    renderCreator(
      creatorAddress,
      vi.fn(async () => creatorAddress),
      onVisibilityChange,
    );

    await user.click(await screen.findByRole("button", { name: "Public" }));

    expect(onVisibilityChange).toHaveBeenCalledWith(false);
    expect(await screen.findByText("Profile is private.")).toBeVisible();
  });

  it("keeps the previous state when saving visibility fails", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      ...creator(true, false),
      posts: [post("own-post", "My moment", true)],
    });
    const onVisibilityChange = vi.fn(async () => {
      throw new Error("Save failed");
    });
    const user = userEvent.setup();
    renderCreator(
      creatorAddress,
      vi.fn(async () => creatorAddress),
      onVisibilityChange,
    );

    await user.click(await screen.findByRole("button", { name: "Private" }));

    expect(onVisibilityChange).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Save failed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Private" })).toBeVisible();
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
