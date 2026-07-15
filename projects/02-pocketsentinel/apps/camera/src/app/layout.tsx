import type { Metadata, Viewport } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "PocketSentinel Camera",
  description: "Phone camera sender for a temporary CCTV stream."
};

export const viewport: Viewport = {
  themeColor: "#176b5b"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
