import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "./HomePage.js";
import { api } from "./kasware.js";

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
}));

const creatorAddress =
  "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/publish" element={<p>Publish page</p>} />
        <Route path="/creators" element={<p>Creators page</p>} />
        <Route path="/creator/:address" element={<p>Creator page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue([]);
  });

  it("speaks to creators and what they get", async () => {
    renderHome();

    expect(
      screen.getByRole("heading", {
        name: "Get paid by the people who love your work.",
      }),
    ).toBeVisible();
    expect(screen.getByText(/You keep 99%/i)).toBeVisible();
    await screen.findByText("What your fans see");
  });

  it("shows a real profile as a subscribed fan sees it", async () => {
    renderHome();

    expect(
      screen.getByRole("img", {
        name: /a subscribed fan's view of a creator's profile/i,
      }),
    ).toBeVisible();
    expect(screen.getByText("What your fans see")).toBeVisible();
    expect(screen.getByText("Yonatan Sompolinsky")).toBeVisible();
    expect(screen.getByText("One day of access · 10 KAS")).toBeVisible();
    expect(screen.getByText("Subscribed")).toBeVisible();
    expect(screen.getByText("BlockDAG explanation with AI")).toBeVisible();
    expect(screen.getByText("5 KAS")).toBeVisible();
    await screen.findByText("What your fans see");
  });

  it("gives a creator one clear door", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("link", { name: "Start publishing" }));

    expect(await screen.findByText("Publish page")).toBeVisible();
  });

  it("gives fans a door of their own", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("link", { name: "Browse creators" }));

    expect(await screen.findByText("Creators page")).toBeVisible();
  });

  it("names real creators for fans when the directory has them", async () => {
    vi.mocked(api).mockResolvedValue([
      {
        address: creatorAddress,
        displayAddress: "kaspatest:...",
        displayName: "Maya",
      },
    ]);
    const user = userEvent.setup();
    renderHome();

    await user.click(await screen.findByRole("link", { name: "Maya" }));

    expect(await screen.findByText("Creator page")).toBeVisible();
  });

  it("speaks human language, not blockchain jargon", async () => {
    const { container } = renderHome();
    await screen.findByText("What your fans see");
    const copy = (container.textContent ?? "").toLowerCase();

    for (const jargon of ["wallet", "blockchain", "on-chain", "settle"]) {
      expect(copy).not.toContain(jargon);
    }
  });

  it("never tells the visitor to pay before they can act", async () => {
    const { container } = renderHome();
    await screen.findByText("What your fans see");
    const intro = (
      container.querySelector(".home-intro")?.textContent ?? ""
    ).toLowerCase();

    for (const phrasings of ["unlock", "paid post", "pay to"]) {
      expect(intro).not.toContain(phrasings);
    }
  });
});
