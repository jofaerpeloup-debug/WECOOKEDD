const { AppError } = require('../../shared/errors/app-error');

const MAX_JSONLD_BYTES = 256 * 1024;
const encoder = new TextEncoder();

function importError(statusCode, code, message) {
  return new AppError(message, { statusCode, code });
}

function hasRecipeType(value) {
  const types = Array.isArray(value?.['@type']) ? value['@type'] : [value?.['@type']];
  return types.includes('Recipe');
}

function candidatesFromDocument(document) {
  if (Array.isArray(document)) return document.filter(hasRecipeType);
  if (!document || typeof document !== 'object') return [];
  if (!Object.hasOwn(document, '@graph')) return hasRecipeType(document) ? [document] : [];
  if (!Array.isArray(document['@graph'])) return [];
  const candidates = document['@graph'].filter(hasRecipeType);
  if (hasRecipeType(document)) candidates.unshift(document);
  return candidates;
}

function scriptMediaType(node) {
  const type = node.attrs?.find((attribute) => attribute.name.toLowerCase() === 'type')?.value || '';
  return type.split(';', 1)[0].trim().toLowerCase();
}

function collectJsonLdText(node, output) {
  if (node.tagName === 'script' && scriptMediaType(node) === 'application/ld+json') {
    const text = (node.childNodes || [])
      .filter((child) => child.nodeName === '#text')
      .map((child) => child.value || '')
      .join('');
    if (text.trim()) output.push(text);
  }
  for (const child of node.childNodes || []) collectJsonLdText(child, output);
}

async function extractRecipeJsonLd(html, { parseHtml } = {}) {
  const parse = parseHtml || (await import('parse5')).parse;
  const document = parse(html);
  const blocks = [];
  collectJsonLdText(document, blocks);

  let aggregateBytes = 0;
  const candidates = [];
  for (const block of blocks) {
    aggregateBytes += encoder.encode(block).byteLength;
    if (aggregateBytes > MAX_JSONLD_BYTES) {
      throw importError(
        413,
        'RECIPE_IMPORT_JSONLD_TOO_LARGE',
        "The page's structured recipe data is too large to import."
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(block);
    } catch {
      throw importError(
        422,
        'RECIPE_IMPORT_JSONLD_INVALID',
        'The page contains invalid Recipe JSON-LD.'
      );
    }
    candidates.push(...candidatesFromDocument(parsed));
  }

  if (candidates.length === 0) {
    throw importError(422, 'RECIPE_IMPORT_NO_RECIPE', 'No Recipe JSON-LD was found on this page.');
  }
  if (candidates.length > 1) {
    throw importError(
      422,
      'RECIPE_IMPORT_MULTIPLE_RECIPES',
      'The page contains multiple Recipe candidates; paste one Recipe JSON-LD object instead.'
    );
  }

  const candidate = candidates[0];
  if (encoder.encode(JSON.stringify(candidate)).byteLength > MAX_JSONLD_BYTES) {
    throw importError(
      413,
      'RECIPE_IMPORT_JSONLD_TOO_LARGE',
      "The page's structured recipe data is too large to import."
    );
  }
  return candidate;
}

module.exports = {
  MAX_JSONLD_BYTES,
  candidatesFromDocument,
  extractRecipeJsonLd,
};
