import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "HookRelay",
  description: "Webhook delivery, signing, replay, and delivery log scaffold."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
