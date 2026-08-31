import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { COPY } from "@onlykas/shared";
import { PublishPage } from "./PublishPage.js";
import { uploadMedia, waitForVerification } from "./upload.js";

vi.mock("./upload.js", () => ({
  uploadMedia: vi.fn(),
  waitForVerification: vi.fn(),
}));

const address = `kaspatest:${"q".repeat(60)}`;

describe("creator publish experience", () => {
  it("lets creators start before connecting a wallet", async () => {
    const signIn = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PublishPage address={null} signIn={signIn} signingIn={false} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /share something special/i }),
    ).toBeVisible();
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["image"], "release.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Title"), "First light");
    await user.type(screen.getByLabelText("Description"), "A private image");
    await user.type(screen.getByLabelText(/Price/), "1.25");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("uploads, validates, and cancels permanent publication without a request", async () => {
    vi.mocked(uploadMedia).mockImplementation(async (_file, progress) => {
      progress(100);
      return "upload-id";
    });
    vi.mocked(waitForVerification).mockResolvedValue({
      id: "upload-id",
      state: "VERIFIED",
      expiresAt: new Date().toISOString(),
      error: null,
    });
    const fetchSpy = vi.spyOn(window, "fetch");
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PublishPage address={address} signIn={vi.fn()} signingIn={false} />
      </MemoryRouter>,
    );
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["image"], "release.png", { type: "image/png" }),
    );
    await user.type(screen.getByLabelText("Title"), "First light");
    await user.type(screen.getByLabelText("Description"), "A private image");
    await user.type(screen.getByLabelText(/Price/), "1.25");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Media ready.")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveTextContent(COPY.permanence);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(COPY.publishingCancelled)).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("reports exact media size validation errors", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PublishPage address={address} signIn={vi.fn()} signingIn={false} />
      </MemoryRouter>,
    );
    const oversized = new File(["image"], "huge.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 25_000_001 });
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      oversized,
    );
    expect(screen.getByText(COPY.imageTooLarge)).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});
