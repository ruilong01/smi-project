import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ProjectPopup from "./ProjectPopup.jsx";
import SourceCard from "./SourceCard.jsx";
import { publicResearchProjects } from "../data/researchProjectData.js";
import { getSourcesForProject } from "../data/sourceRegistry.js";

describe("project evidence components", () => {
  it("renders a compact project popup with why-shown evidence and More link", () => {
    const project = publicResearchProjects[0];
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProjectPopup
          onClose={vi.fn()}
          onInteractionEnd={vi.fn()}
          onInteractionStart={vi.fn()}
          position={{ x: 50, y: 50 }}
          project={project}
        />
      </MemoryRouter>
    );

    expect(html).toContain(project.title);
    expect(html).toContain("Why this is shown");
    expect(html).toContain("supporting sources");
    expect(html).toContain(`/projects/${project.slug}`);
  });

  it("renders source cards with original source link and supported fields", () => {
    const project = publicResearchProjects[0];
    const source = getSourcesForProject(project)[0];
    const html = renderToStaticMarkup(<SourceCard source={source} />);

    expect(html).toContain(source.title);
    expect(html).toContain(source.publisher);
    expect(html).toContain("Open original source");
    expect(html).toContain(source.supportedProjectFields[0]);
  });
});
