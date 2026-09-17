import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HomePage } from "./HomePage.js";

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/creators" element={<p>Creators page</p>} />
        <Route path="/publish" element={<p>Publish page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  it("names the app for a first-time visitor", () => {
    renderHome();

    expect(screen.getByText(/OnlyKas is built on Kaspa/i)).toBeVisible();
  });

  it("explains what OnlyKas is for everyone", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { name: "Paid posts, fan to creator." }),
    ).toBeVisible();
  });

  it("says Kaspa decides access and OnlyKas stores the media", () => {
    renderHome();

    expect(screen.getByText(/Kaspa decides who can unlock it/i)).toBeVisible();
    expect(screen.getByText(/OnlyKas stores the media/i)).toBeVisible();
  });

  it("speaks human language, not blockchain jargon", () => {
    const { container } = renderHome();
    const copy = (container.textContent ?? "").toLowerCase();

    for (const jargon of ["wallet", "blockchain", "on-chain", "settle"]) {
      expect(copy).not.toContain(jargon);
    }
  });

  it("opens the creators directory from the consumer door", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("link", { name: "Explore creators" }));

    expect(await screen.findByText("Creators page")).toBeVisible();
  });

  it("opens the publish form from the creator door", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("link", { name: "Publish a post" }));

    expect(await screen.findByText("Publish page")).toBeVisible();
  });
});
