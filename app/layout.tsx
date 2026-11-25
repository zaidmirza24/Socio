import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saikil Shakti - Samajwadi Party Social Engagement Monitor",
  description: "Automated engagement tracking and volunteer rankings for social media campaigns.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 antialiased">{children}</body>
    </html>
  );
}

