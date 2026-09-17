import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { COPY } from "./copy.js";
import { PublishPage } from "./PublishPage.js";
import { api } from "./kasware.js";
import { uploadMedia } from "./upload.js";

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
}));
vi.mock("./upload.js", () => ({
  uploadMedia: vi.fn(),
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
      <PublishPage address={currentAddress} signIn={signIn} signingIn={false} />
    </MemoryRouter>,
  );
}

function prepareSuccessfulPublish() {
  vi.mocked(uploadMedia).mockImplementation(
    async (_file, _caption, _price, progress) => {
      progress(100);
      return { id: "upload-id", duplicate: false };
    },
  );
}

function PostRoute() {
  const { id } = useParams();
  return <div>post:{id}</div>;
}

function renderPublishWithNavigation() {
  return render(
    <MemoryRouter initialEntries={["/publish"]}>
      <Routes>
        <Route
          path="/publish"
          element={
            <PublishPage address={address} signIn={vi.fn(async () => address)} signingIn={false} />
          }
        />
        <Route path="/post/:id" element={<PostRoute />} />
      </Routes>
    </MemoryRouter>,
  );
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

    expect(screen.getByRole("img", { name: /selected image preview/i })).toBeVisible();
    expect(screen.getByLabelText(/Caption/)).toHaveValue("Shared just for supporters.");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^publish/i }));

    expect(signIn).toHaveBeenCalledOnce();
    expect(uploadMedia).toHaveBeenCalledOnce();
  });

  it("lets captions and price be edited", async () => {
    prepareSuccessfulPublish();
    const user = userEvent.setup();
    renderPage();
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["video"], "release.mp4", { type: "video/mp4" }),
    );
    await user.clear(screen.getByLabelText(/Caption/));
    await user.type(screen.getByLabelText(/Caption/), "A private video");
    await user.clear(screen.getByLabelText(/Price/));
    await user.type(screen.getByLabelText(/Price/), "1.25");
    await user.click(screen.getByRole("button", { name: /^publish/i }));

    expect(uploadMedia).toHaveBeenCalledWith(
      expect.any(File),
      "A private video",
      "1.25",
      expect.any(Function),
    );
  });

  it("reads a zero price as free and any amount as paid", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["video"], "release.mp4", { type: "video/mp4" }),
    );

    const price = screen.getByLabelText(/Price/);
    expect(price).toHaveValue("1");
    expect(screen.getByRole("button", { name: "Publish" })).toBeVisible();

    await user.clear(price);
    await user.type(price, "0");
    expect(
      screen.getByRole("button", { name: "Publish for free" }),
    ).toBeVisible();

    await user.clear(price);
    await user.type(price, "0.1");
    expect(screen.getByRole("button", { name: "Publish" })).toBeVisible();
  });

  it("publishes a zero price as free", async () => {
    prepareSuccessfulPublish();
    const user = userEvent.setup();
    renderPage();
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["video"], "release.mp4", { type: "video/mp4" }),
    );
    const price = screen.getByLabelText(/Price/);
    await user.clear(price);
    await user.type(price, "0");
    await user.click(screen.getByRole("button", { name: "Publish for free" }));

    expect(uploadMedia).toHaveBeenCalledWith(
      expect.any(File),
      expect.any(String),
      "0",
      expect.any(Function),
    );
  });

  it("never shows the price on the publish button", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText("Publishing is free.")).toBeVisible();

    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["video"], "release.mp4", { type: "video/mp4" }),
    );

    const button = screen.getByRole("button", { name: "Publish" });
    expect(button).toBeVisible();
    expect(button).not.toHaveTextContent(/KAS/i);
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

  it("opens the existing post when the media was already published", async () => {
    vi.mocked(uploadMedia).mockResolvedValueOnce({
      id: "existing-post-id",
      duplicate: true,
    });
    const user = userEvent.setup();
    renderPublishWithNavigation();
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["image"], "duplicate.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: /^publish/i }));

    expect(await screen.findByText("post:existing-post-id")).toBeVisible();
  });

  it("keeps the error when the same media has no existing post", async () => {
    vi.mocked(uploadMedia).mockRejectedValueOnce(
      new Error(COPY.mediaAlreadyPublished),
    );
    const user = userEvent.setup();
    renderPage();
    await user.upload(
      screen.getByLabelText(/choose image or video/i),
      new File(["image"], "duplicate.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: /^publish/i }));

    expect(await screen.findByText(COPY.mediaAlreadyPublished)).toBeVisible();
    expect(screen.getByRole("button", { name: /^publish/i })).toBeVisible();
  });

  it("reports exact media size validation errors", async () => {
    const user = userEvent.setup();
    renderPage();
    const oversized = new File(["image"], "huge.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 25_000_001 });
    await user.upload(screen.getByLabelText(/choose image or video/i), oversized);
    expect(screen.getByText(COPY.imageTooLarge)).toBeVisible();
    expect(screen.getByRole("button", { name: /^publish/i })).toBeDisabled();
  });
});
