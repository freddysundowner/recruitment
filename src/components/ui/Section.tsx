import { ChevronRight } from "lucide-react";

/**
 * A collapsible part of a page. It starts open only when it matters right now, and shows a one-line status in its
 * heading, so the page reads as a short list instead of a wall of forms.
 */
export function Section({ id, title, status, tone, open, children }: {
  id?: string;
  title: string;
  status?: string;
  tone?: "good" | "warn" | "bad";
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={open} className="section card" style={{ scrollMarginTop: 80 }}>
      <summary>
        <ChevronRight size={16} className="chev" />
        <span className="h2 flex-1">{title}</span>
        {status && <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{status}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
