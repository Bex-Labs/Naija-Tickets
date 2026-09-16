import type { Metadata } from 'next';
import { Bricolage_Grotesque, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const brandFont = Bricolage_Grotesque({
  variable: '--font-naija-brand',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
  title: 'Naija Tickets | Discover new experiences',
  description:
    'Discover concerts, festivals, conferences and remarkable nights across Nigeria.',
  openGraph: {
    title: 'Naija Tickets | Discover new experiences',
    description:
      'Discover concerts, festivals, conferences and remarkable nights across Nigeria.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Naija Tickets | Discover new experiences',
    description:
      'Discover concerts, festivals, conferences and remarkable nights across Nigeria.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${brandFont.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
