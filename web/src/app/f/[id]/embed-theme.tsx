"use client";

import { useLayoutEffect } from "react";

// Inside another website's iframe, match that site (light unless &theme=dark) instead of the
// visitor's device setting. Not saved, so it never changes the visitor's own DealerVoice choice.
export function EmbedTheme({ theme }: { theme: "light" | "dark" }) {
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return null;
}
