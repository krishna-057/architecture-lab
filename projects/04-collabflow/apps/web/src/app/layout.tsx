import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "CollabFlow",
  description: "Local-first workspace shell with Yjs document state and snapshot export."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
