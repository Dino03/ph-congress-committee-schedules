import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';

export const metadata: Metadata = {
  title: 'PH Congress Committee Schedules',
  description: 'Browse upcoming committee hearings from the Philippine Senate and House of Representatives.',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased h-full flex flex-col">
        <header className="bg-card border-b border-border shadow-sm">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex items-center justify-between h-16">
              <Link href="/" className="text-xl font-bold text-foreground">
                PH Committee Schedules
              </Link>
              <div className="flex items-center gap-4">
                <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                  Calendar
                </Link>
                <Link href="/meetings" className="text-sm font-medium text-muted-foreground hover:text-foreground">
                  Meetings
                </Link>
              </div>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
