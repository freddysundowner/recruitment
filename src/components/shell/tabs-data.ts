// Kept apart from the client component so server pages can read it.
export const TABS = {
  candidates: [
    { href: "/pipeline", label: "Pipeline board" },
    { href: "/candidates", label: "All candidates", match: ["/candidates"] },
  ],
  employers: [
    { href: "/employers", label: "Employers" },
    { href: "/job-orders", label: "Job orders" },
  ],
  money: [
    { href: "/finance", label: "Cash and invoices" },
    { href: "/reports", label: "Reports" },
  ],
  todo: [
    { href: "/todo", label: "Everything" },
    { href: "/verify", label: "Documents" },
    { href: "/follow-up", label: "Follow-up" },
    { href: "/complaints", label: "Complaints" },
    { href: "/messages", label: "Messages" },
  ],
};
