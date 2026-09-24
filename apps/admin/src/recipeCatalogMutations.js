async function mutateAndRefresh(mutate, refreshCatalog) {
  const recipe = await mutate();
  refreshCatalog?.(recipe);
  return recipe;
}

export function createDraftAndRefresh(body, refreshCatalog, mutate) {
  return mutateAndRefresh(() => mutate(body), refreshCatalog);
}

export function updateRecipeAndRefresh(id, body, refreshCatalog, mutate) {
  return mutateAndRefresh(() => mutate(id, body), refreshCatalog);
}

export function publishRecipeAndRefresh(id, body, refreshCatalog, mutate) {
  return mutateAndRefresh(() => mutate(id, body), refreshCatalog);
}

export function archiveRecipeAndRefresh(id, expectedUpdatedAt, refreshCatalog, mutate) {
  return mutateAndRefresh(() => mutate(id, expectedUpdatedAt), refreshCatalog);
}

export function restoreRecipeAndRefresh(id, expectedUpdatedAt, refreshCatalog, mutate) {
  return mutateAndRefresh(() => mutate(id, expectedUpdatedAt), refreshCatalog);
}
