import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { COPY } from "@onlykas/shared";
import { PublishPage } from "./PublishPage.js";
import { api } from "./kasware.js";
import { uploadMedia, waitForVerification } from "./upload.js";

vi.mock("./kasware.js", () => ({ api: vi.fn() }));
vi.mock("./upload.js", () => ({
  uploadMedia: vi.fn(),
  waitForVerification: vi.fn(),
}));

const address = `kaspatest:${"q".repeat(60)}`;

function renderPage({
  currentAddress = address,
  signIn = vi.fn(async () => address),
}: {
  currentAddress?: string | null;
  signIn?: () => Promise<string | null>;
} = {}) {
  return render(
    <MemoryRouter>
      <PublishPage
        address={currentAddress}
        displayName="Maya"
        signIn={signIn}
        signingIn={false}
      />
    </MemoryRouter>,
  );
}

function prepareSuccessfulPublish() {
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
  vi.mocked(api).mockResolvedValue({ id: "post-id" });
}

beforeEach(() => vi.clearAllMocks());

describe("creator publish experience", () => {
  it("publishes an image with defaults after signing in", async () => {
    prepareSuccessfulPublish();
    const signIn = vi.fn(async () => address);
    const user = userEvent.setup();
    renderPage({ currentAddress: null, signIn });

    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["image"], "release.png", { type: "image/png" }),
    );

    expect(
      screen.getByRole("img", { name: /selected image preview/i }),
    ).toBeVisible();
    expect(screen.getByText("Supporters view for 1")).toBeVisible();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(signIn).toHaveBeenCalledOnce();
    expect(uploadMedia).toHaveBeenCalledOnce();
    expect(api).toHaveBeenCalledWith("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        uploadId: "upload-id",
        title: "Private photo",
        description: "Shared just for supporters.",
        priceKas: "1",
        permanenceConfirmed: true,
      }),
    });
  });

  it("keeps optional details editable", async () => {
    prepareSuccessfulPublish();
    const user = userEvent.setup();
    renderPage();
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["video"], "release.mp4", { type: "video/mp4" }),
    );
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "First light");
    await user.clear(screen.getByLabelText("Note"));
    await user.type(screen.getByLabelText("Note"), "A private video");
    await user.clear(screen.getByLabelText(/Price/));
    await user.type(screen.getByLabelText(/Price/), "1.25");
    await user.click(screen.getByRole("button", { name: /^publish/i }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/posts", {
        method: "POST",
        body: expect.stringContaining('"title":"First light"'),
      }),
    );
  });

  it("does nothing after cancelled sign-in", async () => {
    const signIn = vi.fn(async () => null);
    const user = userEvent.setup();
    renderPage({ currentAddress: null, signIn });
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["image"], "release.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: /^publish/i }));

    expect(signIn).toHaveBeenCalledOnce();
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it("explains when the same media was already published", async () => {
    prepareSuccessfulPublish();
    vi.mocked(api)
      .mockRejectedValueOnce(new Error(COPY.mediaAlreadyPublished))
      .mockResolvedValueOnce({ id: "new-post-id" });
    const user = userEvent.setup();
    renderPage();
    const mediaInput = screen.getByLabelText(/choose image or video/i);
    await user.upload(
      mediaInput,
      new File(["image"], "duplicate.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: /^publish/i }));

    expect(
      await screen.findByText("You've already published this photo."),
    ).toBeVisible();
    expect(
      screen.queryByText(COPY.mediaAlreadyPublished),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^publish/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Choose another photo" }),
    );
    await user.upload(
      mediaInput,
      new File(["new image"], "new.png", { type: "image/png" }),
    );

    expect(
      screen.queryByText(COPY.mediaAlreadyPublished),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^publish/i }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(uploadMedia).toHaveBeenCalledTimes(2);
  });

  it("reports exact media size validation errors", async () => {
    const user = userEvent.setup();
    renderPage();
    const oversized = new File(["image"], "huge.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 25_000_001 });
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      oversized,
    );
    expect(screen.getByText(COPY.imageTooLarge)).toBeVisible();
    expect(screen.getByRole("button", { name: /^publish/i })).toBeDisabled();
  });
});
