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
  it("speaks to creators and what they get", () => {
    renderHome();

    expect(screen.getByText("For creators")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Get paid by the people who love your work.",
      }),
    ).toBeVisible();
    expect(screen.getByText(/Your subscribers pay you directly/i)).toBeVisible();
  });

  it("shows the product instead of describing it", () => {
    renderHome();

    expect(screen.getByText("What your subscribers see")).toBeVisible();
    expect(
      screen.getByRole("img", { name: /members-only video post/i }),
    ).toBeVisible();
  });

  it("gives a creator one clear door", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("link", { name: "Start publishing" }));

    expect(await screen.findByText("Publish page")).toBeVisible();
  });

  it("keeps the subscriber door quiet", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("link", { name: "See creators" }));

    expect(await screen.findByText("Creators page")).toBeVisible();
  });

  it("speaks human language, not blockchain jargon", () => {
    const { container } = renderHome();
    const copy = (container.textContent ?? "").toLowerCase();

    for (const jargon of ["wallet", "blockchain", "on-chain", "settle"]) {
      expect(copy).not.toContain(jargon);
    }
  });

  it("never tolls a visitor with unlock or paid-post language", () => {
    const { container } = renderHome();
    const copy = (container.textContent ?? "").toLowerCase();

    for (const phrasings of ["unlock", "paid post"]) {
      expect(copy).not.toContain(phrasings);
    }
  });
});
