"use client";

import Script from "next/script";

// Loads Dograh's web-call widget for this dealership's agent (browser mic, no phone number needed).
export function TalkWidget({ src }: { src: string }) {
  return (
    <Script
      id="dograh-widget"
      src={src}
      strategy="afterInteractive"
      data-dograh-context={JSON.stringify({ source: "dealervoice-dashboard" })}
    />
  );
}
