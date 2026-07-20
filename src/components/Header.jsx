import { Anchor, Radar, Satellite } from "lucide-react";

export default function Header({ selectedCountryCount, activeFilter }) {
  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <Anchor size={22} />
        </div>
        <div>
          <p className="eyebrow">Maritime research intelligence</p>
          <h1>Global Maritime Research Intelligence Map</h1>
        </div>
      </div>

      <div className="header-metrics" aria-label="Dashboard summary">
        <div className="metric">
          <Radar size={17} />
          <span>{selectedCountryCount} active hubs</span>
        </div>
        <div className="metric">
          <Satellite size={17} />
          <span>{activeFilter}</span>
        </div>
      </div>
    </header>
  );
}
