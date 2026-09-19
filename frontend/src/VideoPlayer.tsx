import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { VideoIcon } from "./Icons.js";
import { formatTime } from "./format.js";

const DOUBLE_TAP_MS = 250;
const SEEK_STEP = 10;
const DEAD_ZONE_RATIO = 0.05;

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
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
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
    },
    [],
  );

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
    video.current.muted = !video.current.muted;
    setMuted(video.current.muted);
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
    >
      <video
        ref={video}
        src={src}
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onError={onError}
      />
      {flash && (
        <span className={`video-seek is-${flash}`} role="status">
          {flash === "back" ? `-${SEEK_STEP}s` : `+${SEEK_STEP}s`}
        </span>
      )}
      <div className="video-controls">
        <input
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
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute video" : "Mute video"}
          title={muted ? "Unmute" : "Mute"}
        >
          <VideoIcon name={muted ? "unmute" : "mute"} />
        </button>
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
