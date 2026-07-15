import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "PocketSentinel Dashboard",
  description: "Realtime viewer and detection event timeline."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
