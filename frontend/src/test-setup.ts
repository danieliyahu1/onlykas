import "@testing-library/jest-dom/vitest";

Object.defineProperty(URL, "createObjectURL", {
  value: vi.fn(() => "blob:preview"),
});
Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn() });
