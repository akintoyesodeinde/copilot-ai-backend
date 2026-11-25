import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CodePilot AI API',
  description: 'Headless REST API for CodePilot AI — Intelligent Code Review Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
