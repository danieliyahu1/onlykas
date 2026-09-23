import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { VideoIcon } from "./Icons.js";
import { formatTime } from "./format.js";

const DOUBLE_TAP_MS = 250;
const SEEK_STEP = 10;
const DEAD_ZONE_RATIO = 0.05;
const VOLUME_STEP = 0.05;
const CONTROLS_IDLE_MS = 3000;

export function VideoPlayer({
  src,
  label,
  onError,
}: {
  src: string;
  label: string;
  onError: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [flash, setFlash] = useState<"back" | "forward" | null>(null);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === player.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  function clearHideTimer() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      setControlsVisible(false);
    }, CONTROLS_IDLE_MS);
  }

  function handlePlay() {
    scheduleHide();
  }

  function handlePause() {
    clearHideTimer();
    setControlsVisible(true);
  }

  function handlePointerActivity(event: MouseEvent<HTMLDivElement>) {
    setControlsVisible(true);
    if (video.current?.paused) return;
    if ((event.target as HTMLElement).closest(".video-controls")) {
      clearHideTimer();
      return;
    }
    scheduleHide();
  }

  function handlePointerLeave() {
    clearHideTimer();
    setControlsVisible(false);
  }

  function togglePlayback() {
    if (!video.current) return;
    if (video.current.paused) void video.current.play();
    else video.current.pause();
  }

  function seek(value: number) {
    if (!video.current) return;
    video.current.currentTime = value;
    setCurrentTime(value);
  }

  function toggleMute() {
    if (!video.current) return;
    const next = !video.current.muted;
    video.current.muted = next;
    if (!next && video.current.volume === 0) {
      video.current.volume = 1;
      setVolume(1);
    }
    setMuted(next);
  }

  function changeVolume(value: number) {
    if (!video.current) return;
    video.current.volume = value;
    setVolume(value);
    const next = value === 0;
    video.current.muted = next;
    setMuted(next);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void player.current?.requestFullscreen();
  }

  function skip(clientX: number) {
    const rect = player.current?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      const middle = rect.left + rect.width / 2;
      if (Math.abs(clientX - middle) < rect.width * DEAD_ZONE_RATIO) return;
      seekTo(currentTime + (clientX < middle ? -SEEK_STEP : SEEK_STEP));
      setFlash(clientX < middle ? "back" : "forward");
    } else {
      seekTo(currentTime + SEEK_STEP);
      setFlash("forward");
    }
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 600);
  }

  function seekTo(value: number) {
    const target = Math.max(0, value);
    seek(duration > 0 ? Math.min(duration, target) : target);
  }

  function handleSurfaceClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".video-controls")) return;
    event.preventDefault();

    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      skip(event.clientX);
      return;
    }

    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      togglePlayback();
    }, DOUBLE_TAP_MS);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft") seek(Math.max(0, currentTime - 5));
    else if (event.key === "ArrowRight") seek(Math.min(duration, currentTime + 5));
    else if (event.key.toLowerCase() === "m") toggleMute();
    else if (event.key.toLowerCase() === "f") toggleFullscreen();
  }

  return (
    <div
      ref={player}
      className="video-player"
      tabIndex={0}
      role="group"
      aria-label={`${label} video`}
      onKeyDown={handleKeyDown}
      onClick={handleSurfaceClick}
      onMouseMove={handlePointerActivity}
      onMouseLeave={handlePointerLeave}
    >
      <video
        ref={video}
        src={src}
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={handlePlay}
        onPause={handlePause}
        onError={onError}
      />
      {flash && (
        <span className={`video-seek is-${flash}`} role="status">
          {flash === "back" ? `-${SEEK_STEP}s` : `+${SEEK_STEP}s`}
        </span>
      )}
      <div className={`video-controls${controlsVisible ? "" : " is-hidden"}`}>
        <input
          className="video-progress"
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          aria-label="Video progress"
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="video-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <div className="video-volume-control">
          <VolumeSlider value={muted ? 0 : volume} onChange={changeVolume} />
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute video" : "Mute video"}
            title={muted ? "Unmute" : "Mute"}
          >
            <VideoIcon name={muted ? "mute" : "unmute"} />
          </button>
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen video"}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          <VideoIcon name={fullscreen ? "exit-fullscreen" : "fullscreen"} />
        </button>
      </div>
    </div>
  );
}

function VolumeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function updateFromPointer(clientY: number) {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    const ratio = 1 - (clientY - rect.top) / rect.height;
    const clamped = Math.min(1, Math.max(0, ratio));
    onChange(Math.round(clamped * 20) / 20);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragging.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in some environments.
    }
    updateFromPointer(event.clientY);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragging.current) updateFromPointer(event.clientY);
  }

  function releasePointer(event: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in some environments.
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const direction =
      event.key === "ArrowUp" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowDown" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(Math.min(1, Math.max(0, value + direction * VOLUME_STEP)));
  }

  return (
    <div
      ref={track}
      className="video-volume"
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value}
      title="Volume"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onKeyDown={handleKeyDown}
    >
      <span className="video-volume-value">{Math.round(value * 100)}</span>
      <span className="video-volume-track">
        <span className="video-volume-fill" style={{ height: `${value * 100}%` }} />
      </span>
    </div>
  );
}
