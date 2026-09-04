import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { COPY } from "@onlykas/shared";
import { MembershipPage } from "./MembershipPage.js";
import { api, signPreparedPayment } from "./kasware.js";

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
  getWalletPublicKey: vi.fn(async () => "a".repeat(64)),
  signPreparedPayment: vi.fn(async () => "signed-by-wallet"),
}));

const address = `kaspatest:${"q".repeat(60)}`;

function confirmedDeploy(id: string, priceSompi: string) {
  return {
    id,
    creator: address,
    covenantId: "covenant-1",
    priceSompi,
    description: "A day of access.",
    state: "CONFIRMED",
    transactionId: "a".repeat(64),
    rejection: null,
    offer: {
      id,
      creator: address,
      covenantId: "covenant-1",
      priceSompi,
      description: "A day of access.",
      isActive: true,
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(1).toISOString(),
    },
  };
}

function renderPage({
  currentAddress = address,
  signIn = vi.fn(async () => address),
}: {
  currentAddress?: string | null;
  signIn?: () => Promise<string | null>;
} = {}) {
  return render(
    <MemoryRouter>
      <MembershipPage
        address={currentAddress}
        signIn={signIn}
        signingIn={false}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("creator membership offer experience", () => {
  it("publishes a live offer after signing and wallet signature", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({ offers: [] })
      .mockResolvedValueOnce({
        id: "deploy-1",
        creator: address,
        covenantId: "covenant-1",
        priceSompi: "150000000",
        description: "A day of access.",
        state: "PREPARED",
        transaction: '{"inputs":[{}]}',
        fingerprint: "fingerprint",
        transactionId: null,
        rejection: null,
        offer: null,
      })
      .mockResolvedValueOnce(confirmedDeploy("deploy-1", "150000000"))
      .mockResolvedValueOnce({
        offers: [confirmedDeploy("deploy-1", "150000000").offer],
      });
    const user = userEvent.setup();
    renderPage();

    await user.clear(screen.getByLabelText(/Price/));
    await user.type(screen.getByLabelText(/Price/), "1.5");
    await user.click(screen.getByRole("button", { name: /^publish offer/i }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/membership/offers/propose", {
        method: "POST",
        body: JSON.stringify({
          price: "1.5",
          description: "A day of access.",
          payoutPk: "a".repeat(64),
        }),
      }),
    );
    expect(signPreparedPayment).toHaveBeenCalledWith('{"inputs":[{}]}');
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/membership/deploys/deploy-1/finalize",
        {
          method: "POST",
          body: JSON.stringify({ signedTransaction: "signed-by-wallet" }),
        },
      ),
    );
    expect((await screen.findAllByText(COPY.offerLive)).length).toBeGreaterThan(
      0,
    );
  });

  it("reports validation errors without calling the network", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.clear(screen.getByLabelText(/Price/));
    await user.type(screen.getByLabelText(/Price/), "0");
    await user.click(screen.getByRole("button", { name: /^publish offer/i }));

    expect(await screen.findByText(COPY.invalidPrice)).toBeVisible();
    expect(api).not.toHaveBeenCalledWith(
      "/api/membership/offers/propose",
      expect.anything(),
    );
  });

  it("refuses to publish after a cancelled sign-in", async () => {
    const signIn = vi.fn(async () => null);
    const user = userEvent.setup();
    renderPage({ currentAddress: null, signIn });
    await user.click(screen.getByRole("button", { name: /^publish offer/i }));

    expect(signIn).toHaveBeenCalledOnce();
    expect(api).not.toHaveBeenCalled();
  });
});
