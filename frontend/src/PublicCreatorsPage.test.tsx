import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PublicCreatorsPage } from "./PublicCreatorsPage.js";
import { api, ApiError } from "./kasware.js";

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
}));

const address =
  "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";

describe("PublicCreatorsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists public wallets and links to their profiles", async () => {
    vi.mocked(api).mockResolvedValue([
      { address, displayAddress: "kaspatest:...", displayName: "Maya" },
    ]);
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
    render(
      <MemoryRouter>
        <PublicCreatorsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("No creators yet.")).toBeVisible();
  });

  it("shows an error when the directory cannot be loaded", async () => {
    vi.mocked(api).mockRejectedValue(
      new ApiError("SERVER_UNAVAILABLE", "Server down", 0),
    );
    render(
      <MemoryRouter>
        <PublicCreatorsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Server down")).toBeVisible();
    expect(screen.queryByText("No creators yet.")).not.toBeInTheDocument();
  });
});
