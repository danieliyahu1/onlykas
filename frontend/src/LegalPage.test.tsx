import { render, screen } from "@testing-library/react";
import { PUBLIC_PAGES } from "@kaskama/shared";
import { LegalPage } from "./LegalPage.js";

describe("LegalPage", () => {
  it.each(PUBLIC_PAGES)("renders every section of $path", (page) => {
    render(<LegalPage page={page} />);

    expect(
      screen.getByRole("heading", { level: 1, name: page.heading }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Last updated:/)).toHaveTextContent(page.updated);
    for (const section of page.sections) {
      expect(
        screen.getByRole("heading", { level: 2, name: section.heading }),
      ).toBeInTheDocument();
    }
  });
});
