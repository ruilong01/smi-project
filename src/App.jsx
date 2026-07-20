import { lazy, Suspense, useMemo, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import Header from "./components/Header.jsx";
import FilterBar from "./components/FilterBar.jsx";
import CountryProfilePanel from "./components/CountryProfilePanel.jsx";
import WorldMap from "./components/WorldMap.jsx";

// Route-level code splitting (Goal 5): detail pages load on demand so the
// dashboard's initial bundle stays small. The map dashboard remains eager.
const CountryDetail = lazy(() => import("./pages/CountryDetail.jsx"));
const ProjectDetail = lazy(() => import("./pages/ProjectDetail.jsx"));
const SourceStatus = lazy(() => import("./pages/SourceStatus.jsx"));
const TopicDetail = lazy(() => import("./pages/TopicDetail.jsx"));
import { filters } from "./data/maritimeResearchData.js";
import {
  countryMatchesTopicFilter,
  getLiveDataStatusLabel,
  isLiveResearchDataAvailable,
  liveResearchCountries,
  liveResearchMeta,
  publicResearchProjects,
} from "./data/researchProjectData.js";

function MapDashboard() {
  const [activeFilter, setActiveFilter] = useState("All");
  const [popupCountry, setPopupCountry] = useState(null);
  const [popupProject, setPopupProject] = useState(null);
  const [profileCountry, setProfileCountry] = useState(null);

  const highlightedCountries = useMemo(() => {
    if (activeFilter === "All") {
      return liveResearchCountries;
    }

    return liveResearchCountries.filter((country) =>
      countryMatchesTopicFilter(country, activeFilter)
    );
  }, [activeFilter]);

  const selectedCountry = profileCountry ?? popupCountry;

  function openCountryPopup(country) {
    setPopupCountry(country);
    setPopupProject(null);
    setProfileCountry(null);
  }

  function openProjectPopup(project) {
    setPopupProject(project);
    setPopupCountry(null);
    setProfileCountry(null);
  }

  function openCountryProfile(country) {
    setProfileCountry(country);
    setPopupCountry(null);
    setPopupProject(null);
  }

  function clearSelection() {
    setPopupCountry(null);
    setPopupProject(null);
    setProfileCountry(null);
  }

  return (
    <main className="app-shell">
      <div className="ocean-grid" aria-hidden="true" />
      <Header
        activeFilter={activeFilter}
        selectedCountryCount={highlightedCountries.length}
      />

      <section className="filter-strip" aria-label="Primary research filters">
        <FilterBar
          activeFilter={activeFilter}
          filters={filters}
          onChange={(filter) => {
            setActiveFilter(filter);
            clearSelection();
          }}
        />
      </section>

      <aside className="hover-drawer" aria-label="Map filters and country list">
        <div className="drawer-tab" aria-hidden="true">
          Explore
        </div>
        <div className="drawer-content">
          <p className="eyebrow">Research filters</p>
          <FilterBar
            activeFilter={activeFilter}
            filters={filters}
            onChange={(filter) => {
              setActiveFilter(filter);
              clearSelection();
            }}
          />

          <section className="drawer-block">
            <p className="eyebrow">Visible hubs</p>
            <h2>{highlightedCountries.length} maritime clusters</h2>
            <div className="hub-list drawer-hub-list">
              {highlightedCountries.map((country) => (
                <button
                  className={`hub-card ${
                    selectedCountry?.id === country.id ? "active" : ""
                  }`}
                  key={country.id}
                  onClick={() => openCountryPopup(country)}
                  type="button"
                >
                  <span>
                    <strong>{country.name}</strong>
                    <small>{country.themes.slice(0, 2).join(" + ")}</small>
                  </span>
                  <b>{country.researchIntensity}</b>
                </button>
              ))}
            </div>
          </section>

          <section className="drawer-block drawer-intensity">
            <p className="eyebrow">Intensity legend</p>
            <div className="drawer-intensity-row">
              <i className="legend-very-low" />
              <span>Very Low: 0-10</span>
            </div>
            <div className="drawer-intensity-row">
              <i className="legend-low" />
              <span>Low: 11-25</span>
            </div>
            <div className="drawer-intensity-row">
              <i className="legend-low-medium" />
              <span>Low-Medium: 26-40</span>
            </div>
            <div className="drawer-intensity-row">
              <i className="legend-medium" />
              <span>Medium: 41-55</span>
            </div>
            <div className="drawer-intensity-row">
              <i className="legend-medium-high" />
              <span>Medium-High: 56-70</span>
            </div>
            <div className="drawer-intensity-row">
              <i className="legend-high" />
              <span>High: 71-85</span>
            </div>
            <div className="drawer-intensity-row">
              <i className="legend-very-high" />
              <span>Very High: 86-100</span>
            </div>
            <div className="drawer-intensity-row">
              <i className="legend-selected" />
              <span>Red: selected focus ring</span>
            </div>
          </section>

          <section className="drawer-block drawer-data-status">
            <p className="eyebrow">Data status</p>
            <p>{getLiveDataStatusLabel()}</p>
            <div className="source-status-list">
              {liveResearchMeta.sourceStatus.map((source) => (
                <article key={source.sourceId}>
                  <strong>{source.sourceName}</strong>
                  <span>{source.extractionType}</span>
                  <small>Last success: {source.lastSuccessfulSync || "failed"}</small>
                </article>
              ))}
            </div>
            <Link className="source-status-link" to="/sources/status">
              View source status
            </Link>
          </section>
        </div>
      </aside>

      <section className="dashboard-layout">
        <div className="map-panel">
          <WorldMap
            activeFilter={activeFilter}
            countries={liveResearchCountries}
            dataStatusLabel={getLiveDataStatusLabel()}
            onClearSelection={clearSelection}
            onClosePopup={() => setPopupCountry(null)}
            onCloseProjectPopup={() => setPopupProject(null)}
            onCountryClick={openCountryPopup}
            onProjectClick={openProjectPopup}
            onViewProfile={openCountryProfile}
            popupCountry={popupCountry}
            popupProject={popupProject}
            projects={publicResearchProjects}
            selectedCountry={selectedCountry}
            isProfileOpen={Boolean(profileCountry)}
          />
          {!isLiveResearchDataAvailable ? (
            <div className="live-data-unavailable">
              <h2>Live research data is temporarily unavailable.</h2>
              <p>
                Last successful synchronisation:{" "}
                {liveResearchMeta.lastSuccessfulSync || "not available"}
              </p>
              <button onClick={() => window.location.reload()} type="button">
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <CountryProfilePanel
        country={profileCountry}
        onClose={() => setProfileCountry(null)}
      />
    </main>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="detail-shell" style={{ display: "grid", placeItems: "center" }}>
          <p style={{ color: "rgba(196, 228, 255, 0.8)" }}>Loading…</p>
        </div>
      }
    >
      <Routes>
        <Route element={<MapDashboard />} path="/" />
        <Route element={<CountryDetail />} path="/country/:slug" />
        <Route element={<ProjectDetail />} path="/projects/:projectSlug" />
        <Route element={<SourceStatus />} path="/sources/status" />
        <Route element={<TopicDetail />} path="/topic/:slug" />
        <Route element={<MapDashboard />} path="*" />
      </Routes>
    </Suspense>
  );
}
