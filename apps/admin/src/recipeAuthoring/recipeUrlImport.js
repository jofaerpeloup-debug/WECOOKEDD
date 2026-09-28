import { createElement, Fragment } from 'react';
import { parseRecipeIntake } from './recipeIntake.js';

export function RecipeUrlImportControls({ url, urlImport, busy, onUrlChange, onImport }) {
  const loading = urlImport.status === 'loading';
  const buttonLabel = loading ? 'Importing…' : urlImport.status === 'error' ? 'Retry import' : 'Import URL';
  return createElement(
    Fragment,
    null,
    createElement(
      'div',
      { className: 'wc-recipe-url-import' },
      createElement(
        'label',
        null,
        'Public recipe URL',
        createElement('input', {
          id: 'recipe-url-import',
          name: 'recipeUrl',
          type: 'url',
          value: url,
          maxLength: 2048,
          disabled: busy || loading,
          placeholder: 'https://example.com/recipe',
          onChange: (event) => onUrlChange(event.target.value),
        })
      ),
      createElement('button', {
        type: 'button',
        className: 'wc-btn-secondary',
        disabled: busy || loading || !url.trim(),
        onClick: onImport,
      }, buttonLabel)
    ),
    urlImport.status === 'error'
      ? createElement('div', { className: 'wc-author-field-error', role: 'alert' }, urlImport.error)
      : null,
    urlImport.status === 'success'
      ? createElement(
        'p',
        { className: 'wc-recipe-import-source', role: 'status' },
        'Imported preview from ',
        createElement('a', { href: urlImport.sourceUrl, target: '_blank', rel: 'noreferrer' }, urlImport.sourceUrl),
        '. Review it below; nothing has been saved.'
      )
      : null
  );
}

export async function importRecipeUrlForPreview(url, { request } = {}) {
  const importRequest = request || (await import('../recipeApi.js')).importRecipeUrl;
  const result = await importRequest(url);
  const input = JSON.stringify(result.candidate);
  return {
    sourceUrl: result.sourceUrl,
    input,
    preview: parseRecipeIntake(input),
  };
}

export function createRecipeUrlImportHandlers({
  url,
  request,
  setInput,
  setPreview,
  setApplication,
  setUrlImport,
}) {
  return {
    async importFromUrl() {
      setUrlImport({ status: 'loading', sourceUrl: '', error: '' });
      try {
        const result = await importRecipeUrlForPreview(url, request ? { request } : undefined);
        setInput(result.input);
        setPreview(result.preview);
        setApplication(null);
        setUrlImport({ status: 'success', sourceUrl: result.sourceUrl, error: '' });
        return result;
      } catch (error) {
        const failure = {
          status: 'error',
          sourceUrl: '',
          error: error?.message || 'The recipe URL could not be imported.',
        };
        setUrlImport(failure);
        return { error: failure.error };
      }
    },
  };
}
