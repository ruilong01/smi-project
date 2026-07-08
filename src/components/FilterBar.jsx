import { Filter, MapPinned } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getTopicSlug } from "../data/topicData.js";

export default function FilterBar({ filters, activeFilter, onChange }) {
  const navigate = useNavigate();

  function openTopic(filter) {
    onChange(filter);

    if (filter === "All") {
      navigate("/");
      return;
    }

    navigate(`/topic/${getTopicSlug(filter)}`);
  }

  function filterMap(event, filter) {
    event.stopPropagation();
    onChange(filter);
  }

  return (
    <nav className="filter-bar" aria-label="Research topics and map filters">
      {filters.map((filter) => {
        const isActive = activeFilter === filter;
        const isAll = filter === "All";

        return (
          <span
            className={`filter-chip ${isActive ? "active" : ""}`}
            key={filter}
            role="group"
          >
            <button
              className="filter-chip-label"
              onClick={() => openTopic(filter)}
              type="button"
            >
              {isAll ? <MapPinned size={15} /> : null}
              {filter}
            </button>
            <button
              aria-label={
                isAll ? "Show all countries on globe" : `Filter globe by ${filter}`
              }
              className="filter-chip-action"
              onClick={(event) => filterMap(event, filter)}
              title={isAll ? "Show all countries" : `Filter globe by ${filter}`}
              type="button"
            >
              <Filter size={14} />
            </button>
          </span>
        );
      })}
    </nav>
  );
}
