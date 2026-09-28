import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SalesBound NoteSpace",
  description: "Notes, collections and tags for SalesBound.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request. The Content-Security-Policy set in
  // proxy.ts carries a per-request nonce, which Next.js can only attach to
  // scripts rendered for that request; a prerendered page would have none and
  // its scripts would be blocked.
  await connection();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-workspace">{children}</body>
    </html>
  );
}
