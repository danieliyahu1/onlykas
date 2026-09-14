import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PublicCreatorsPage } from "./PublicCreatorsPage.js";
import { api } from "./kasware.js";

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
}));

const address = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";

describe("PublicCreatorsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists public wallets and links to their profiles", async () => {
    vi.mocked(api).mockResolvedValue([{ address, displayAddress: "kaspatest:...", displayName: "Maya" }]);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/creators"]}>
        <Routes>
          <Route path="/creators" element={<PublicCreatorsPage />} />
          <Route path="/creator/:address" element={<p>Profile</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Maya")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Maya/ }));
    expect(await screen.findByText("Profile")).toBeVisible();
  });

  it("shows an empty state", async () => {
    vi.mocked(api).mockResolvedValue([]);
    render(<MemoryRouter><PublicCreatorsPage /></MemoryRouter>);
    expect(await screen.findByText("No public creators yet.")).toBeVisible();
  });
});
