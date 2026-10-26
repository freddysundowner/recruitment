export default function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 34, width: "40%" }} />
      <div className="skel" style={{ height: 96 }} />
      <div className="skel" style={{ height: 260 }} />
    </div>
  );
}
