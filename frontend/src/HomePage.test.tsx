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
  it("explains what OnlyKas is", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { name: "Get paid for what you post." }),
    ).toBeVisible();
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
