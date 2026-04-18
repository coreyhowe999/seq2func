import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Transcriptome Assembly & Annotation",
  description: "De novo transcriptome assembly and protein annotation pipeline",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {/* Navigation */}
        <nav className="bg-navy-900 border-b border-navy-700 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <Link
                href="/"
                className="flex items-center gap-3 hover:opacity-90 transition-opacity"
              >
                <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center font-bold text-white text-sm">
                  Tx
                </div>
                <span className="text-lg font-semibold text-gray-100">
                  Transcriptome Pipeline
                </span>
              </Link>
              <div className="flex items-center gap-6">
                <Link
                  href="/"
                  className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
                >
                  New Run
                </Link>
                <Link
                  href="/runs"
                  className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
                >
                  All Runs
                </Link>
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
