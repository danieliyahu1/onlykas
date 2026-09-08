import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CreatorResponse } from "@onlykas/shared";
import { CreatorPage } from "./PublicPages.js";
import { api, signPreparedPayment } from "./kasware.js";

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

    await user.click(await screen.findByRole("button", { name: "Create membership offer" }));

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

    await user.click(await screen.findByRole("button", { name: "Become a member for 1 KAS" }));

    expect(api).toHaveBeenCalledWith(`/api/membership/${encodeURIComponent(creatorAddress)}/prepare`, { method: "POST" });
    expect(signPreparedPayment).toHaveBeenCalledWith("{}", [1]);
    await waitFor(() => expect(screen.getByText("Member")).toBeVisible());
  });
});
