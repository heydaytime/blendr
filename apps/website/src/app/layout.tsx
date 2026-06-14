import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blendr — Watch YouTube Together",
  description:
    "Watch YouTube videos in perfect sync with friends. No screenshare needed. Free Chrome extension.",
  icons: {
    icon: "/blendr-favicon.svg",
    apple: "/blendr-favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
