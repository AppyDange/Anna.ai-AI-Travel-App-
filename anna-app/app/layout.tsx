import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anna.ai — plan a trip together",
  description:
    "Describe a trip, get a plan with real prices, share one link, and let your friends change it.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
