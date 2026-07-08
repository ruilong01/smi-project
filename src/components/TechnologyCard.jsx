import { Cpu } from "lucide-react";
import { technologyExplanations } from "../data/researchProjectData.js";

export default function TechnologyCard({ technology }) {
  return (
    <article className="technology-card">
      <span>
        <Cpu size={18} />
      </span>
      <div>
        <h3>{technology}</h3>
        <p>
          {technologyExplanations[technology] ??
            "Technology explanation is not available in the current prototype data."}
        </p>
      </div>
    </article>
  );
}
