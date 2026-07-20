import {
  DATA_STATUS,
  DATA_UPDATED_UNTIL,
  maritimeResearchData,
} from "./maritimeResearchData.js";

const topicDefinitions = [
  {
    name: "Green Shipping",
    slug: "green-shipping",
    iconKey: "leaf",
    shortDescription:
      "Research on lower-emission vessel operations, clean corridors, efficiency, and lifecycle decarbonisation.",
    overview:
      "Green shipping connects vessel design, port operations, fuel transition, routing, and emissions monitoring. In this prototype, the topic highlights countries where decarbonisation appears as a major maritime research theme.",
    keyTechnologies: [
      "Voyage optimisation and emissions analytics",
      "Battery-electric and hybrid vessel systems",
      "Wind-assisted propulsion",
      "Shore power and port electrification",
    ],
    keyApplications: [
      "Green shipping corridors",
      "Low-emission harbour craft",
      "Fleet efficiency programs",
      "Port emissions monitoring",
    ],
    institutions: [
      "Singapore Maritime Institute",
      "SINTEF Ocean",
      "DNV",
      "Delft University of Technology",
      "Maersk",
    ],
    exampleProjects: [
      "Green and digital shipping corridor programs",
      "Electric ferry and zero-emission vessel pilots",
      "Wind-assisted propulsion and clean vessel concepts",
    ],
    trends: [
      "Port-vessel coordination is becoming central to emissions reduction.",
      "Green corridor pilots are shifting from concept studies toward operational trials.",
      "Energy-efficiency tools increasingly combine sensor data with AI-assisted planning.",
    ],
  },
  {
    name: "Smart Ports",
    slug: "smart-ports",
    iconKey: "container",
    shortDescription:
      "Research on port digitalisation, logistics orchestration, automation, and connected maritime trade flows.",
    overview:
      "Smart port research focuses on how ports coordinate ships, cargo, hinterland links, safety, emissions, and trade documentation through digital systems.",
    keyTechnologies: [
      "Port digital twins",
      "Terminal automation",
      "Just-in-time arrival systems",
      "Port community data platforms",
    ],
    keyApplications: [
      "Container terminal optimisation",
      "Digital port clearance",
      "Hinterland logistics visibility",
      "Port call synchronisation",
    ],
    institutions: [
      "Maritime and Port Authority of Singapore",
      "PSA International",
      "Port of Rotterdam",
      "Fraunhofer CML",
      "DP World",
    ],
    exampleProjects: [
      "Digital port clearance and just-in-time arrival pilots",
      "Automated container terminal systems",
      "Smart logistics and port visibility tools",
    ],
    trends: [
      "Ports are becoming data coordination platforms, not only physical infrastructure.",
      "Digital twin research is moving closer to operational planning and disruption response.",
      "Cyber-resilient smart port architecture is becoming more important as systems connect.",
    ],
  },
  {
    name: "Autonomous Vessels",
    slug: "autonomous-vessels",
    iconKey: "radar",
    shortDescription:
      "Research on autonomous navigation, remote operations, sensing, assurance, and safety-critical vessel control.",
    overview:
      "Autonomous vessel research spans ship perception, decision support, remote operation centres, collision avoidance, testing ranges, and regulatory assurance.",
    keyTechnologies: [
      "Autonomous navigation stacks",
      "Sensor fusion and perception",
      "Remote operation centres",
      "Collision avoidance and assurance",
    ],
    keyApplications: [
      "Autonomous harbour craft",
      "Coastal cargo vessels",
      "Ocean robotics",
      "Offshore inspection platforms",
    ],
    institutions: [
      "Kongsberg Maritime",
      "Korea Research Institute of Ships & Ocean Engineering",
      "University of Tokyo",
      "National Oceanography Centre",
      "MIT Sea Grant",
    ],
    exampleProjects: [
      "Autonomous harbour craft trials",
      "Autonomous ship test areas",
      "Autonomous coastal shipping demonstrations",
    ],
    trends: [
      "Assurance and safety cases are becoming as important as autonomy algorithms.",
      "Near-shore and harbour use cases are more mature than open-ocean autonomy.",
      "Remote operation and autonomy are converging in practical vessel trials.",
    ],
  },
  {
    name: "Maritime AI",
    slug: "maritime-ai",
    iconKey: "brain",
    shortDescription:
      "Research on AI-assisted maritime operations, prediction, optimisation, monitoring, and decision support.",
    overview:
      "Maritime AI links operational data, vessel movement, port planning, ocean sensing, maintenance, risk, and route optimisation into decision-support tools.",
    keyTechnologies: [
      "Predictive analytics",
      "AI-assisted route optimisation",
      "Computer vision for maritime monitoring",
      "Digital twins and simulation",
    ],
    keyApplications: [
      "Voyage planning",
      "Port congestion prediction",
      "Safety monitoring",
      "Fleet performance analytics",
    ],
    institutions: [
      "National University of Singapore",
      "Nanyang Technological University",
      "Fraunhofer CML",
      "American Bureau of Shipping",
      "CSIRO",
    ],
    exampleProjects: [
      "AI-assisted navigation and collision avoidance research",
      "Intelligent shipping and route optimisation pilots",
      "Digital maritime logistics and port optimisation",
    ],
    trends: [
      "AI is increasingly embedded inside port, vessel, and fleet workflows.",
      "Research is moving from analytics dashboards toward operational decision support.",
      "Data quality, trust, and explainability remain important adoption constraints.",
    ],
  },
  {
    name: "Alternative Fuels",
    slug: "alternative-fuels",
    iconKey: "fuel",
    shortDescription:
      "Research on hydrogen, ammonia, methanol, LNG transition pathways, bunkering readiness, and fuel safety.",
    overview:
      "Alternative fuel research explores how vessel engines, storage systems, bunkering operations, safety rules, and port infrastructure can support lower-carbon fuels.",
    keyTechnologies: [
      "Hydrogen and ammonia propulsion",
      "Methanol-ready vessel design",
      "Fuel-cell maritime systems",
      "Alternative fuel bunkering infrastructure",
    ],
    keyApplications: [
      "Deep-sea fuel transition",
      "Green methanol vessel programs",
      "Harbour craft fuel pilots",
      "Port fuel readiness planning",
    ],
    institutions: [
      "Technical University of Denmark",
      "Mitsui O.S.K. Lines",
      "Hyundai Heavy Industries",
      "German Aerospace Center",
      "CMA CGM",
    ],
    exampleProjects: [
      "Ammonia-fuelled vessel development",
      "Green methanol vessel programs",
      "Hydrogen and ammonia-ready ship concepts",
    ],
    trends: [
      "Fuel pathway research is splitting by vessel segment and route profile.",
      "Bunkering safety and infrastructure readiness are becoming major research questions.",
      "Industry pilots increasingly pair alternative fuels with corridor planning.",
    ],
  },
  {
    name: "Maritime Cybersecurity",
    slug: "maritime-cybersecurity",
    iconKey: "shield",
    shortDescription:
      "Research on cyber resilience for connected ports, vessels, logistics networks, and maritime operational technology.",
    overview:
      "Maritime cybersecurity covers vessel systems, port operating environments, data exchange, cargo visibility, communications, and incident resilience.",
    keyTechnologies: [
      "Operational technology risk modelling",
      "Secure port data exchange",
      "Vessel network monitoring",
      "Cyber-resilient digital twins",
    ],
    keyApplications: [
      "Connected vessel protection",
      "Smart port resilience",
      "Trade data assurance",
      "Maritime incident response exercises",
    ],
    institutions: [
      "Lloyd's Register",
      "Port of Rotterdam",
      "American Bureau of Shipping",
      "University College London",
      "AD Ports Group",
    ],
    exampleProjects: [
      "Cyber-resilient port infrastructure research",
      "Cybersecurity for connected vessels and ports",
      "Port resilience and cyber-risk studies",
    ],
    trends: [
      "Cybersecurity is becoming part of smart port design rather than a late add-on.",
      "Connected vessels expand the attack surface across ship, shore, and cloud systems.",
      "Maritime cyber work is increasingly linked to operational continuity and insurance.",
    ],
  },
];

export const topicData = topicDefinitions.map((topic) => ({
  ...topic,
  relatedCountries: maritimeResearchData
    .filter((country) => country.themes.includes(topic.name))
    .map((country) => country.name),
  dataStatus: DATA_STATUS,
  dataUpdatedUntil: DATA_UPDATED_UNTIL,
}));

export const topicSlugMap = new Map(
  topicData.map((topic) => [topic.name, topic.slug])
);

export const topicBySlug = new Map(
  topicData.map((topic) => [topic.slug, topic])
);

export function getTopicSlug(topicName) {
  return topicSlugMap.get(topicName);
}

export function getTopicBySlug(slug) {
  return topicBySlug.get(slug);
}
