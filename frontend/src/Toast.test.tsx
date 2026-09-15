import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toast, useToast } from "./Toast.js";

function ToastHarness() {
  const { toast, showToast } = useToast();
  return (
    <>
      <button onClick={() => showToast("Saved.", "success")}>Show</button>
      <Toast toast={toast} />
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
});
