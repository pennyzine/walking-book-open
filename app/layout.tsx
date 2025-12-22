import type React from "react"
import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { ServiceWorkerRegister } from "@/components/service-worker-register"

const shipporiMincho = localFont({
  src: "../public/fonts/ShipporiMinchoB1-Regular.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-serif",
})

export const metadata: Metadata = {
  title: "Walking Book",
  description: "Break the manuscript free. For free.",
  metadataBase: new URL("https://www.walkingbook.dev"),
  manifest: "/manifest.json",
  openGraph: {
    title: "Walking Book",
    description: "Break the manuscript free. For free.",
    url: "/",
    siteName: "Walking Book",
    type: "website",
    images: [
      {
        url: "/og-v2.png",
        width: 1200,
        height: 630,
        alt: "Walking Book",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Walking Book",
    description: "Break the manuscript free. For free.",
    images: ["/og-v2.png"],
  },
  icons: {
    icon: [
      {
        url: "/favicon.ico",
      },
      {
        url: "/icon-192.png",
        type: "image/png",
        sizes: "192x192",
      },
      {
        url: "/icon-512.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: [
      {
        url: "/apple-icon.png",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${shipporiMincho.variable} font-sans antialiased`}>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
