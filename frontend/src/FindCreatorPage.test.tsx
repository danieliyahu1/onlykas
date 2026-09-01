import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FindCreatorPage } from "./FindCreatorPage.js";
import { api } from "./kasware.js";

vi.mock("./kasware.js", () => ({ api: vi.fn() }));

const address = `kaspatest:${"q".repeat(60)}`;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/find"]}>
      <Routes>
        <Route path="/find" element={<FindCreatorPage />} />
        <Route path="/creator/:address" element={<p>Profile opened</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FindCreatorPage", () => {
  it("opens the exact creator profile after trimming whitespace", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByLabelText("Name or Kaspa address"),
      `  ${address}  `,
    );
    await user.click(screen.getByRole("button", { name: /^search/i }));

    expect(await screen.findByText("Profile opened")).toBeVisible();
  });

  it("rejects an incomplete address without navigating", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByLabelText("Name or Kaspa address"),
      "kaspatest:wrong",
    );
    await user.click(screen.getByRole("button", { name: /^search/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "complete Kaspa testnet address",
    );
    expect(screen.queryByText("Profile opened")).not.toBeInTheDocument();
  });

  it("does not show an empty result message while typing", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Name or Kaspa address"), "maya");

    expect(screen.queryByText("No profiles found.")).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it("shows an empty result message after a search returns no creators", async () => {
    vi.mocked(api).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Name or Kaspa address"), "maya");
    await user.click(screen.getByRole("button", { name: /^search/i }));

    expect(await screen.findByText("No profiles found.")).toBeVisible();
    expect(api).toHaveBeenCalledWith("/api/creators/search?q=maya");
  });

  it("loads a search from its shareable URL", async () => {
    vi.mocked(api).mockResolvedValueOnce([]);
    render(
      <MemoryRouter initialEntries={["/find?q=maya"]}>
        <Routes>
          <Route path="/find" element={<FindCreatorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("No profiles found.")).toBeVisible();
    expect(screen.getByLabelText("Name or Kaspa address")).toHaveValue("maya");
    expect(api).toHaveBeenCalledWith("/api/creators/search?q=maya");
  });
});
