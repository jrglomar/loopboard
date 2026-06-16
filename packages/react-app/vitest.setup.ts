import "@testing-library/jest-dom/vitest";

// ── jsdom stubs for Radix UI primitives ─────────────────────────────────────
// Radix components (Select, Tooltip, ScrollArea) rely on pointer-capture and
// ResizeObserver APIs that jsdom does not implement. Stubs prevent test crashes.
// See ADR-009 note on Radix + jsdom.

// Pointer capture stubs (required by Radix Select / Dialog portals)
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => undefined;
}

// scrollIntoView stub (used by Radix Select when focusing options)
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

// ResizeObserver stub (used by Radix ScrollArea)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// window.matchMedia stub (used by some Radix components for media queries)
if (typeof window.matchMedia === "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
