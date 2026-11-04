import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Socio - Social Media Engagement Monitoring",
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

