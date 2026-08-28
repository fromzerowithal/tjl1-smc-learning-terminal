import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const githubRepository = process.env.GITHUB_REPOSITORY?.split('/') ?? [];
const pagesMetadataBase = process.env.GITHUB_PAGES === 'true' && githubRepository.length === 2
  ? new URL(`https://${githubRepository[0]}.github.io/`)
  : undefined;

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: pagesMetadataBase,
  title: 'TJL1 · SMC Learning Terminal',
  description: 'A live XAU/USD Smart Money Concepts learning and analysis terminal.',
  openGraph: {
    title: 'TJL1 · SMC Learning Terminal',
    description: 'Read structure. Track liquidity. Learn the narrative.',
    type: 'website',
    images: [{ url: `${basePath}/og.png`, width: 1672, height: 941, alt: 'TJL1 Smart Money Concepts Learning Terminal' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TJL1 · SMC Learning Terminal',
    description: 'Read structure. Track liquidity. Learn the narrative.',
    images: [`${basePath}/og.png`],
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
