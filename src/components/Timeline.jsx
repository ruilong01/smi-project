export default function Timeline({ milestones }) {
  if (!milestones?.length) {
    return <p className="source-empty">No verified milestones available.</p>;
  }

  return (
    <ol className="project-timeline">
      {milestones.map((milestone) => (
        <li className={`timeline-item ${milestone.status}`} key={milestone.label}>
          <time>{milestone.date}</time>
          <div>
            <strong>{milestone.label}</strong>
            <span>{milestone.status}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
