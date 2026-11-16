import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Android Remote Hub · Assistência privada", description: "Seus Androids, conectados com autorização. Plataforma privada de assistência remota.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
