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
      screen.getByRole("heading", { name: "Creators and their subscribers, directly." }),
    ).toBeVisible();
  });

  it("says Kaspa authorizes access and anyone can check", () => {
    renderHome();

    expect(screen.getByText(/Kaspa decides who can see a post/i)).toBeVisible();
    expect(screen.getByText(/anyone can check/i)).toBeVisible();
    expect(
      screen.getByText(/OnlyKas stores the photos and videos/i),
    ).toBeVisible();
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
