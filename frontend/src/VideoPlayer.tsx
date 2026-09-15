import { useRef, useState, type KeyboardEvent } from "react";
import { VideoIcon } from "./Icons.js";
import { formatTime } from "./format.js";

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
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

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

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft") seek(Math.max(0, currentTime - 5));
    else if (event.key === "ArrowRight") seek(Math.min(duration, currentTime + 5));
    else if (event.key.toLowerCase() === "m") toggleMute();
    else if (event.key.toLowerCase() === "f") void video.current?.requestFullscreen();
  }

  return (
    <div
      className="video-player"
      tabIndex={0}
      role="group"
      aria-label={`${label} video`}
      onKeyDown={handleKeyDown}
    >
      <video
        ref={video}
        src={src}
        playsInline
        preload="metadata"
        onClick={togglePlayback}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onError={onError}
      />
      {!playing && (
        <button
          className="video-play"
          type="button"
          aria-label="Play video"
          title="Play"
          onClick={togglePlayback}
        >
          <VideoIcon name="play" />
        </button>
      )}
      <div className="video-controls">
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={playing ? "Pause video" : "Play video"}
          title={playing ? "Pause" : "Play"}
        >
          <VideoIcon name={playing ? "pause" : "play"} />
        </button>
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
          onClick={() => void video.current?.requestFullscreen()}
          aria-label="Fullscreen video"
          title="Fullscreen"
        >
          <VideoIcon name="fullscreen" />
        </button>
      </div>
    </div>
  );
}
