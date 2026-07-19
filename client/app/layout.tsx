import type { Metadata } from 'next';
import { Fjalla_One, Open_Sans } from 'next/font/google';
import './globals.css';

const fjallaOne = Fjalla_One({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-heading',
});

const openSans = Open_Sans({
  subsets: ['latin'],
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: "Shadow'Khan",
  description: "Shadow'Khan card game",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${fjallaOne.variable} ${openSans.variable} bg-black font-[family-name:var(--font-body)]`}>
        {children}
      </body>
    </html>
  );
}
