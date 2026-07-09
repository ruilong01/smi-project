# Open Maritime R&D Data Source Roadmap

This project should prefer structured APIs and official open-data portals before
custom website scraping. Each source should preserve source URLs, extraction
method, supported fields, licence notes, and confidence signals.

## Active Sources

| Source | Access | Current use |
| --- | --- | --- |
| OpenAlex | Free public API | Publication-backed maritime research records |
| Crossref | Free public API | DOI metadata and direct publication search |
| Research Organization Registry | Free public API | Institution enrichment |
| Maritime and Port Authority of Singapore | Official webpages | Singapore maritime R&D source pages |
| UKRI Gateway to Research | Free public API | UK public research funding projects |
| U.S. National Science Foundation Award Search | Free public API | U.S. public research awards |

## High-Priority Sources To Add

| Source | Country / region | Notes |
| --- | --- | --- |
| CORDIS | European Union | Strong EU project data source; API access may require registration. |
| Singapore Maritime Institute | Singapore | Official SMI roadmap and project ecosystem pages. |
| TCOMS | Singapore | Marine and offshore technology R&D centre. |
| NEDO | Japan | Japanese technology demonstration and energy projects. |
| JST | Japan | Japanese research project metadata. |
| NTIS | South Korea | Korean national R&D project data; likely needs language handling. |
| KIMST / KRISO | South Korea | Maritime and ocean R&D sources. |
| Research Council of Norway | Norway | Public funding data for ocean, offshore, and green shipping. |
| Netherlands Enterprise Agency / NWO | Netherlands | Dutch innovation and research funding sources. |
| Innovation Fund Denmark / EUDP | Denmark | Green energy and shipping-related project sources. |

## Maritime And Industry Sources To Evaluate

| Source | Use case |
| --- | --- |
| IMO project and decarbonisation pages | Global shipping policy and technical pilots |
| Global Maritime Forum | Industry decarbonisation initiatives |
| Maersk Mc-Kinney Moller Center for Zero Carbon Shipping | Green fuel and vessel pilots |
| Lloyd's Register Maritime Decarbonisation Hub | Technical reports and project pages |
| DNV maritime research pages | Industry evidence and safety publications |
| ABS, ClassNK, Bureau Veritas, RINA | Classification society pilots and approvals |

## Implementation Rules

- Add one adapter per source family under `scripts/ingestion/adapters/`.
- Keep each adapter polite: low request volume, retries, timeout, and delay.
- Use official APIs or official webpages first.
- Do not treat AI output as evidence; AI enrichment must keep source IDs.
- Do not show scraped images as official unless the source URL, licence, and
  attribution are stored.
- If a source requires registration, put it behind environment variables and
  let extraction continue when credentials are missing.
