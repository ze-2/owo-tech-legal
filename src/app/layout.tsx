import type { Metadata } from "next";
// Keep global imports ordered: shared defaults precede feature styles.
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "@/components/workspace-layout.css";
import "@/components/claim-workspace.css";
import "@/components/conversation-intake.css";
import "@/components/claim-review.css";
import "@/components/research.css";

export const metadata: Metadata = {
  title: "Clearclaim — Make your next step clear",
  description:
    "A thoughtful workspace to organise your Singapore small claim, review official guidance, and prepare for CJTS.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-SG">
      <body>{children}</body>
    </html>
  );
}
