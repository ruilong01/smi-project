// Step 4 of the AI Evidence Selection pipeline (see CLAUDE.md goal tracker
// item 9): turn a page's extracted sections into a small pool of short
// chunks, each tagged with its source URL/page title/heading, ready for the
// (not-yet-implemented) AI evidence-selection step to pick the few most
// important ones from.
//
// Copyright/source-safety rule: this is a pool of short snippets to select
// FROM, not a copy of the article — capped in count and per-chunk length so
// we never approach storing "many long paragraphs" from a source.

import { slugify } from "../normalization.mjs";

const MAX_CHUNKS_PER_PAGE = 8;
const MAX_CHUNK_CHARS = 400;

function splitLongParagraph(text) {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }

  const sentences = text.match(/[^.!?]+[.!?]+|\S+$/g) ?? [text];
  const parts = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > MAX_CHUNK_CHARS && current) {
      parts.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts;
}

/**
 * @param {{sourceUrl: string, pageTitle: string|null, sections: {heading: string, text: string}[]}} page
 * @returns {{chunkId: string, text: string, heading: string, sourceUrl: string, pageTitle: string}[]}
 */
export function chunkPage(page) {
  const chunks = [];
  const pageTitle = page.pageTitle ?? page.sourceUrl;

  for (const section of page.sections ?? []) {
    for (const piece of splitLongParagraph(section.text)) {
      if (chunks.length >= MAX_CHUNKS_PER_PAGE) {
        return chunks;
      }
      chunks.push({
        chunkId: `chunk-${slugify(page.sourceUrl)}-${chunks.length}`,
        text: piece,
        heading: section.heading ?? "",
        sourceUrl: page.sourceUrl,
        pageTitle,
      });
    }
  }

  return chunks;
}
