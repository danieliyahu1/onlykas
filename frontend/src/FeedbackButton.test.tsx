import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { COPY } from "@onlykas/shared";
import { FeedbackButton } from "./FeedbackButton.js";
import { api, ApiError } from "./kasware.js";

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
}));

function stubDialog() {
  HTMLDialogElement.prototype.showModal = vi.fn(function setOpen(
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function clearOpen(
    this: HTMLDialogElement,
  ) {
    this.removeAttribute("open");
  });
}

describe("FeedbackButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDialog();
  });

  it("opens the dialog and asks for text before sending", async () => {
    const user = userEvent.setup();
    render(<FeedbackButton />);

    await user.click(screen.getByRole("button", { name: COPY.feedbackButton }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: COPY.feedbackSend }));
    expect(await screen.findByText(COPY.feedbackRequired)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it("posts the message, closes the dialog, and shows a toast", async () => {
    vi.mocked(api).mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    render(<FeedbackButton />);

    await user.click(screen.getByRole("button", { name: COPY.feedbackButton }));
    const dialog = screen.getByRole("dialog");
    await user.type(screen.getByLabelText(COPY.feedbackLabel), "Nice app");
    await user.click(screen.getByRole("button", { name: COPY.feedbackSend }));

    expect(api).toHaveBeenCalledWith("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ message: "Nice app" }),
    });
    expect(screen.getByText(COPY.feedbackThanks)).toBeInTheDocument();
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
  });

  it("shows the server message when the request fails and lets the sender retry", async () => {
    vi.mocked(api).mockRejectedValue(
      new ApiError("RATE_LIMITED", COPY.feedbackFailed, 429),
    );
    const user = userEvent.setup();
    render(<FeedbackButton />);

    await user.click(screen.getByRole("button", { name: COPY.feedbackButton }));
    await user.type(screen.getByLabelText(COPY.feedbackLabel), "Too many notes");
    await user.click(screen.getByRole("button", { name: COPY.feedbackSend }));

    expect(await screen.findByText(COPY.feedbackFailed)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: COPY.feedbackSend }));
    expect(api).toHaveBeenCalledTimes(2);
  });
});