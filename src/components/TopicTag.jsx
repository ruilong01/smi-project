import { Link } from "react-router-dom";
import { getTopicNameForCategory } from "../data/researchProjectData.js";
import { getTopicSlug } from "../data/topicData.js";

/**
 * A research-category tag (e.g. "Vessel efficiency") that links to its
 * parent /topic/:slug page when one exists (via the topicToProjectCategories
 * reverse lookup), or renders as a plain non-link tag otherwise — categories
 * are more granular than the 6 curated topics, so not every one maps to a
 * topic page.
 */
export default function TopicTag({
  category,
  className = "tag topic-link",
  fallbackClassName = "tag",
  onClick,
}) {
  const topicSlug = getTopicSlug(getTopicNameForCategory(category));

  if (!topicSlug) {
    return <span className={fallbackClassName}>{category}</span>;
  }

  return (
    <Link className={className} onClick={onClick} to={`/topic/${topicSlug}`}>
      {category}
    </Link>
  );
}
