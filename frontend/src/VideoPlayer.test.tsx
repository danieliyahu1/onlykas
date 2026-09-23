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

  it("shows a sound icon while unmuted and a mute icon once muted", () => {
    renderPlayer();
    const mute = screen.getByRole("button", { name: "Mute video" });
    expect(mute.querySelector("path")).toHaveAttribute(
      "d",
      "M3 10v4h4l5 4V6l-5 4H3M16 9c2 2 2 4 0 6M19 6c4 4 4 8 0 12",
    );

    fireEvent.click(mute);

    const unmute = screen.getByRole("button", { name: "Unmute video" });
    expect(unmute.querySelector("path")).toHaveAttribute(
      "d",
      "M3 10v4h4l5 4V6l-5 4H3M16 9l5 6M21 9l-5 6",
    );
  });

  function volumeSlider() {
    const slider = screen.getByRole("slider", { name: "Volume" });
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 40,
      bottom: 100,
      width: 40,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);
    return slider;
  }

  function pressVolumeAt(slider: HTMLElement, clientY: number) {
    fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, clientY }));
  }

  it("reaches the full range, shows the level, and mutes at zero", () => {
    renderPlayer();
    const { video } = readyPlayer();
    const slider = volumeSlider();
    const level = () => slider.querySelector(".video-volume-value")?.textContent;

    pressVolumeAt(slider, 0);
    expect(video.volume).toBe(1);
    expect(video.muted).toBe(false);
    expect(level()).toBe("100");

    pressVolumeAt(slider, 25);
    expect(video.volume).toBe(0.75);
    expect(video.muted).toBe(false);
    expect(level()).toBe("75");

    pressVolumeAt(slider, 50);
    expect(video.volume).toBe(0.5);
    expect(video.muted).toBe(false);
    expect(level()).toBe("50");

    pressVolumeAt(slider, 100);
    expect(video.volume).toBe(0);
    expect(video.muted).toBe(true);
    expect(level()).toBe("0");
    expect(screen.getByRole("button", { name: "Unmute video" })).toBeVisible();
  });

  it("adjusts volume with the keyboard without seeking", () => {
    renderPlayer();
    const { video } = readyPlayer();
    const slider = volumeSlider();

    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(video.volume).toBeCloseTo(0.95);
    expect(video.currentTime).toBe(30);

    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(video.volume).toBe(1);
  });

  it("restores full volume when unmuting from zero", () => {
    renderPlayer();
    const { video } = readyPlayer();
    pressVolumeAt(volumeSlider(), 100);
    expect(video.muted).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Unmute video" }));

    expect(video.volume).toBe(1);
    expect(video.muted).toBe(false);
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
