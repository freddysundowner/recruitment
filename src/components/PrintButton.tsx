"use client";

export function PrintButton() {
  return <button type="button" className="btn print:hidden" onClick={() => window.print()}>Print</button>;
}
