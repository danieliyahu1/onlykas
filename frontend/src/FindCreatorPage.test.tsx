import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type { CreatorSearchResult } from "@onlykas/shared";
import { FindCreatorPage } from "./FindCreatorPage.js";
import { api } from "./kasware.js";

vi.mock("./kasware.js", () => ({ api: vi.fn() }));

const address = `kaspatest:${"q".repeat(60)}`;

function result(name: string): CreatorSearchResult {
  return {
    address: `kaspatest:${name.toLowerCase()}`,
    displayAddress: `kaspatest:${name.toLowerCase()}`,
    displayName: name,
  };
}

function NavTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>go</button>;
}

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
  beforeEach(() => vi.resetAllMocks());

  it("opens the exact creator profile after trimming whitespace", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Name or address"), `  ${address}  `);
    await user.click(screen.getByRole("button", { name: /^search/i }));

    expect(await screen.findByText("Profile opened")).toBeVisible();
  });

  it("rejects an incomplete address without navigating", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Name or address"), "kaspatest:wrong");
    await user.click(screen.getByRole("button", { name: /^search/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("full address");
    expect(screen.queryByText("Profile opened")).not.toBeInTheDocument();
  });

  it("does not show an empty result message while typing", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Name or address"), "maya");

    expect(screen.queryByText("No creators found.")).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it("shows an empty result message after a search returns no creators", async () => {
    vi.mocked(api).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText("Name or address"), "maya");
    await user.click(screen.getByRole("button", { name: /^search/i }));

    expect(await screen.findByText("No creators found.")).toBeVisible();
    expect(api).toHaveBeenCalledWith(
      "/api/creators/search?q=maya",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("searches again when the same query is submitted twice", async () => {
    vi.mocked(api).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();

    const input = screen.getByLabelText("Name or address");
    await user.type(input, "maya");
    await user.click(screen.getByRole("button", { name: /^search/i }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^search/i })).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: /^search/i }));

    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  });

  it("ignores a stale response that resolves after a newer search", async () => {
    let resolveFirst!: (value: CreatorSearchResult[]) => void;
    const first = new Promise<CreatorSearchResult[]>((resolve) => {
      resolveFirst = resolve;
    });
    let resolveSecond!: (value: CreatorSearchResult[]) => void;
    const second = new Promise<CreatorSearchResult[]>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(api)
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);
    render(
      <MemoryRouter initialEntries={["/find?q=first"]}>
        <Routes>
          <Route
            path="/find"
            element={
              <>
                <FindCreatorPage />
                <NavTo to="/find?q=second" />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));

    resolveSecond([result("Second")]);
    resolveFirst([result("First")]);

    expect(await screen.findByText("Second")).toBeVisible();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
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

    expect(await screen.findByText("No creators found.")).toBeVisible();
    expect(screen.getByLabelText("Name or address")).toHaveValue("maya");
    expect(api).toHaveBeenCalledWith(
      "/api/creators/search?q=maya",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
