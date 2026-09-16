import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toast, useToast, type ToastTone } from "./Toast.js";

function ToastHarness({ tone = "success" }: { tone?: ToastTone } = {}) {
  const { toast, showToast, dismissToast } = useToast();
  return (
    <>
      <button onClick={() => showToast("Saved.", tone)}>Show</button>
      <Toast toast={toast} onDismiss={dismissToast} />
    </>
  );
}

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("floats for five seconds and then disappears", () => {
    render(<ToastHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");

    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps an explanation up longer than a confirmation", () => {
    render(<ToastHarness tone="notice" />);

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("restarts the timer when the same message is shown again", () => {
    render(<ToastHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    act(() => vi.advanceTimersByTime(4_000));
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("marks a notice as a status, not an error", () => {
    render(<ToastHarness tone="notice" />);

    fireEvent.click(screen.getByRole("button", { name: "Show" }));

    expect(screen.getByRole("status")).toHaveClass("toast-notice");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["success", "notice"] as const)(
    "holds a %s message open as long as the pointer is over it",
    (tone) => {
      render(<ToastHarness tone={tone} />);

      fireEvent.click(screen.getByRole("button", { name: "Show" }));
      fireEvent.mouseEnter(screen.getByRole("status"));
      act(() => vi.advanceTimersByTime(60_000));
      expect(screen.getByRole("status")).toBeInTheDocument();

      fireEvent.mouseLeave(screen.getByRole("status"));
      act(() => vi.advanceTimersByTime(10_000));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  it("closes on the dismiss button", () => {
    render(<ToastHarness tone="notice" />);

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
