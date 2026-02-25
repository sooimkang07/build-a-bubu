import type { Metadata } from 'next'
import { Inconsolata } from 'next/font/google'
import './globals.css'

const inconsolata = Inconsolata({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '600', '700']
})

export const metadata: Metadata = {
  title: 'BUILD-A-BUBU'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inconsolata.className}>{children}</body>
    </html>
  )
}