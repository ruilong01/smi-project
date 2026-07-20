import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SourceCard from "./SourceCard.jsx";
import { publicResearchProjects } from "../data/researchProjectData.js";
import { getSourcesForProject } from "../data/sourceRegistry.js";

describe("SourceCard", () => {
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
