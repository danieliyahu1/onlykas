export function KaspaMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`kaspa-mark ${className}`}
      title="Kaspa (KAS)"
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" focusable="false">
        <path d="M16 3 6 9v14l10 6 10-6V9L16 3Z" />
        <path d="m10 12 6 4 6-4M10 20l6-4 6 4M16 7v9" />
      </svg>
    </span>
  );
}
