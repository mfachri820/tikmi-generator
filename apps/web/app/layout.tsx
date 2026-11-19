import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TIKMI Generator",
  description: "Asesmen Mandiri Manajemen Risiko dan Infrastruktur TI PJP LR, KPw Bank Indonesia Provinsi DKI Jakarta",
};

/**
 * System fonts only (globals.css): no web-font download at build time, so the app builds offline and on
 * networks that block Google Fonts.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
