import "./globals.css";
import Providers from "./providers";
import NotificationsNavbar from "./components/NotificationsNavbar";

export const metadata = { title: "Tasklane", description: "Project management for teams" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Providers><NotificationsNavbar />{children}</Providers></body>
    </html>
  );
}
