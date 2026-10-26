import type { ReactNode } from "react";

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="h2">{title}</div>
      {children && <div className="muted mt-1 mb-3 max-w-md mx-auto">{children}</div>}
    </div>
  );
}
