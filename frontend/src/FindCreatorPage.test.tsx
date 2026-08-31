import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FindCreatorPage } from "./FindCreatorPage.js";

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

    await user.type(screen.getByLabelText("Creator address"), `  ${address}  `);
    await user.click(screen.getByRole("button", { name: /open profile/i }));

    expect(await screen.findByText("Profile opened")).toBeVisible();
  });

  it("rejects an incomplete address without navigating", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByLabelText("Creator address"),
      "kaspatest:wrong",
    );
    await user.click(screen.getByRole("button", { name: /open profile/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "complete Kaspa testnet address",
    );
    expect(screen.queryByText("Profile opened")).not.toBeInTheDocument();
  });
});
