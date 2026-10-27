import { ChartNoAxesColumnIncreasing } from "lucide-react";

export default function TestCoverageView() {
  return (
    <section className="chapter-editor overview-page">
      <h1>Test coverage</h1>
      <div className="development-state">
        <span className="development-icon">
          <ChartNoAxesColumnIncreasing size={28} />
        </span>
        <span className="development-badge">In development</span>
        <h2>Test coverage is on its way</h2>
        <p>
          This page will show which success criteria are covered by automated
          tests.
        </p>
      </div>
    </section>
  );
}
