const { AppError } = require('../../shared/errors/app-error');
const { fetchRecipeUrl } = require('./recipe-url-fetcher');
const { extractRecipeJsonLd } = require('./recipe-jsonld-extractor');

let importActive = false;

function createRecipeUrlImportService({ fetchPage = fetchRecipeUrl, extractCandidate = extractRecipeJsonLd } = {}) {
  return async function importRecipeUrl(url) {
    if (importActive) {
      throw new AppError('Recipe import is busy. Try again shortly.', {
        statusCode: 503,
        code: 'RECIPE_IMPORT_BUSY',
      });
    }
    importActive = true;
    try {
      const page = await fetchPage(url);
      const candidate = await extractCandidate(page.html);
      return { sourceUrl: page.sourceUrl, candidate };
    } finally {
      importActive = false;
    }
  };
}

const importRecipeUrl = createRecipeUrlImportService();

module.exports = {
  createRecipeUrlImportService,
  importRecipeUrl,
};
