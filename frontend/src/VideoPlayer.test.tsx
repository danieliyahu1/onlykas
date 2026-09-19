import { act, fireEvent, render, screen } from "@testing-library/react";
import { VideoPlayer } from "./VideoPlayer.js";

const playMock = vi.fn();
const pauseMock = vi.fn();
let paused = true;

function renderPlayer() {
  return render(<VideoPlayer src="/media/clip" label="Clip" onError={() => {}} />);
}

function readyPlayer(currentTime = 30, duration = 120) {
  const player = screen.getByRole("group", { name: "Clip video" });
  const video = player.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    writable: true,
    value: currentTime,
  });
  fireEvent.loadedMetadata(video);
  fireEvent.timeUpdate(video);
  return { player, video };
}

function bounds(width = 1000): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: 400,
    width,
    height: 400,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  vi.useFakeTimers();
  paused = true;
  playMock.mockReset().mockImplementation(() => {
    paused = false;
    return Promise.resolve();
  });
  pauseMock.mockReset().mockImplementation(() => {
    paused = true;
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: playMock,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: pauseMock,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get: () => paused,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => null,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("VideoPlayer", () => {
  it("starts and stops on a single tap", () => {
    renderPlayer();
    const player = screen.getByRole("group", { name: "Clip video" });

    fireEvent.click(player);
    act(() => vi.advanceTimersByTime(300));
    expect(playMock).toHaveBeenCalledTimes(1);

    fireEvent.click(player);
    act(() => vi.advanceTimersByTime(300));
    expect(pauseMock).toHaveBeenCalledTimes(1);
  });

  it("skips forward on a right double tap without toggling playback", () => {
    renderPlayer();
    const { player, video } = readyPlayer();
    vi.spyOn(player, "getBoundingClientRect").mockReturnValue(bounds());

    fireEvent.click(player, { clientX: 900 });
    fireEvent.click(player, { clientX: 900 });

    expect(playMock).not.toHaveBeenCalled();
    expect(pauseMock).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(40);
    expect(screen.getByText("+10s")).toBeVisible();
  });

  it("skips back on a left double tap", () => {
    renderPlayer();
    const { player, video } = readyPlayer();
    vi.spyOn(player, "getBoundingClientRect").mockReturnValue(bounds());

    fireEvent.click(player, { clientX: 100 });
    fireEvent.click(player, { clientX: 100 });

    expect(video.currentTime).toBe(20);
    expect(screen.getByText("-10s")).toBeVisible();
  });

  it("leaves a center double tap alone", () => {
    renderPlayer();
    const { player, video } = readyPlayer();
    vi.spyOn(player, "getBoundingClientRect").mockReturnValue(bounds());

    fireEvent.click(player, { clientX: 500 });
    fireEvent.click(player, { clientX: 500 });

    expect(playMock).not.toHaveBeenCalled();
    expect(pauseMock).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(30);
    expect(screen.queryByText("+10s")).toBeNull();
    expect(screen.queryByText("-10s")).toBeNull();
  });

  it("keeps a control click from toggling playback", () => {
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Mute video" }));
    act(() => vi.advanceTimersByTime(300));

    expect(playMock).not.toHaveBeenCalled();
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it("takes the player container fullscreen, never the video", () => {
    const requestFullscreen = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    renderPlayer();
    const player = screen.getByRole("group", { name: "Clip video" });

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen video" }));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.instances[0]).toBe(player);
  });

  it("leaves fullscreen from the same button", () => {
    const exitFullscreen = vi.fn();
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    renderPlayer();
    const player = screen.getByRole("group", { name: "Clip video" });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => player,
    });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));

    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Exit fullscreen" }).querySelector("path"))
      .toHaveAttribute("d", "M9 3v6H3M15 3v6h6M21 15h-6v6M9 21v-6H3");
  });
});
