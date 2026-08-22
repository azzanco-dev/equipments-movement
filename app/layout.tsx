import type { Metadata } from 'next';
import '@/index.css';

export const metadata: Metadata = {
  title: 'Equipment Movement',
  description: 'Equipment entry and exit management',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
