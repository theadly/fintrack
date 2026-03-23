import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fintrack — Personal Finance Dashboard',
  description: 'Personal finance dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
