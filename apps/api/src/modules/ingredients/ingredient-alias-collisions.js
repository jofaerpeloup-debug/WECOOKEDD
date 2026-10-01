const ALIAS_COLLISION_TYPES = Object.freeze([
  'ALIAS_TO_CANONICAL',
  'ALIAS_TO_ALIAS',
  'SELF_ALIAS_TO_CANONICAL',
  'DUPLICATE_ALIASES_WITHIN_INGREDIENT',
]);
const ALIAS_COLLISION_TYPE_ORDER = Object.freeze(
  Object.fromEntries(ALIAS_COLLISION_TYPES.map((type, index) => [type, index]))
);
const UX_COLLISION_TYPES = new Set(ALIAS_COLLISION_TYPES.slice(0, 3));
const MAX_CONFLICT_OWNERS = 10;

function compareText(left, right) {
  const a = left == null ? '' : String(left);
  const b = right == null ? '' : String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function printableId(value) {
  if (value === undefined || value === null) return undefined;
  try {
    return String(value);
  } catch {
    return '(unprintable)';
  }
}

function normalizeIngredientName(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/gu, ' ');
  return normalized || undefined;
}

function ingredientAliasStatus(isActive) {
  if (isActive === true) return 'active';
  if (isActive === false) return 'archived';
  return 'unknown';
}

function compareAliasParticipants(left, right) {
  return compareText(left.ingredientId, right.ingredientId) ||
    (left.source === right.source ? 0 : left.source === 'canonical' ? -1 : 1) ||
    compareText(normalizeIngredientName(left.sourceValue), normalizeIngredientName(right.sourceValue)) ||
    compareText(left.sourceValue, right.sourceValue) ||
    ((left.sourceIndex ?? -1) - (right.sourceIndex ?? -1));
}

function classifyIngredientAliasCollisions(ingredients) {
  const occurrencesByValue = new Map();
  const addOccurrence = (normalizedValue, occurrence) => {
    if (!normalizedValue) return;
    if (!occurrencesByValue.has(normalizedValue)) occurrencesByValue.set(normalizedValue, []);
    occurrencesByValue.get(normalizedValue).push(occurrence);
  };

  for (const ingredient of ingredients) {
    const common = {
      ingredientId: printableId(ingredient?._id),
      canonicalName: ingredient?.name,
      status: ingredientAliasStatus(ingredient?.isActive),
    };
    addOccurrence(normalizeIngredientName(ingredient?.name), {
      ...common,
      source: 'canonical',
      sourceValue: ingredient?.name,
    });
    if (!Array.isArray(ingredient?.aliases)) continue;
    ingredient.aliases.forEach((alias, sourceIndex) => {
      addOccurrence(normalizeIngredientName(alias), {
        ...common,
        source: 'alias',
        sourceValue: alias,
        sourceIndex,
      });
    });
  }

  const collisions = [];
  const addCollision = (normalizedValue, collisionType, participants) => {
    collisions.push({
      normalizedValue,
      collisionType,
      participants: [...participants].sort(compareAliasParticipants),
    });
  };

  for (const [normalizedValue, occurrences] of occurrencesByValue) {
    const canonicals = occurrences.filter((item) => item.source === 'canonical');
    const aliases = occurrences.filter((item) => item.source === 'alias');
    const crossAliases = aliases.filter((alias) =>
      canonicals.some((canonical) => canonical.ingredientId !== alias.ingredientId)
    );
    const crossCanonicals = canonicals.filter((canonical) =>
      aliases.some((alias) => alias.ingredientId !== canonical.ingredientId)
    );
    if (crossAliases.length > 0) {
      addCollision(normalizedValue, 'ALIAS_TO_CANONICAL', [...crossAliases, ...crossCanonicals]);
    }
    if (new Set(aliases.map((alias) => alias.ingredientId)).size > 1) {
      addCollision(normalizedValue, 'ALIAS_TO_ALIAS', aliases);
    }
    const selfAliases = aliases.filter((alias) =>
      canonicals.some((canonical) => canonical.ingredientId === alias.ingredientId)
    );
    if (selfAliases.length > 0) {
      const selfOwnerIds = new Set(selfAliases.map((alias) => alias.ingredientId));
      addCollision(normalizedValue, 'SELF_ALIAS_TO_CANONICAL', [
        ...canonicals.filter((canonical) => selfOwnerIds.has(canonical.ingredientId)),
        ...selfAliases,
      ]);
    }
    const aliasCountsByOwner = new Map();
    for (const alias of aliases) {
      aliasCountsByOwner.set(alias.ingredientId, (aliasCountsByOwner.get(alias.ingredientId) || 0) + 1);
    }
    const duplicateAliases = aliases.filter((alias) => aliasCountsByOwner.get(alias.ingredientId) > 1);
    if (duplicateAliases.length > 0) {
      addCollision(normalizedValue, 'DUPLICATE_ALIASES_WITHIN_INGREDIENT', duplicateAliases);
    }
  }

  return collisions.sort((left, right) =>
    compareText(left.normalizedValue, right.normalizedValue) ||
    (ALIAS_COLLISION_TYPE_ORDER[left.collisionType] - ALIAS_COLLISION_TYPE_ORDER[right.collisionType])
  );
}

function summarizeIngredientAliasCollisions(collisions) {
  const affectedIngredients = new Set();
  const byType = Object.fromEntries(ALIAS_COLLISION_TYPES.map((type) => [type, 0]));
  for (const collision of collisions) {
    byType[collision.collisionType] += 1;
    collision.participants.forEach((participant) => affectedIngredients.add(participant.ingredientId));
  }
  return { total: collisions.length, affectedIngredients: affectedIngredients.size, byType };
}

function proposalDisplayValues(name, aliases) {
  const values = new Map();
  const add = (value, source) => {
    const normalized = normalizeIngredientName(value);
    if (normalized && !values.has(`${normalized}:${source}`)) {
      values.set(`${normalized}:${source}`, value.trim().replace(/\s+/gu, ' '));
    }
  };
  add(name, 'canonical');
  aliases.forEach((alias) => add(alias, 'alias'));
  return values;
}

function classifyProposedIngredientAliasWarnings({ name, aliases, ingredientId }, catalog) {
  const proposalId = '__proposed_ingredient__';
  const excludedId = ingredientId == null ? null : String(ingredientId);
  const comparisonCatalog = catalog.filter((ingredient) => String(ingredient?._id) !== excludedId);
  const proposal = { _id: proposalId, name, aliases, isActive: true };
  const displays = proposalDisplayValues(name, aliases);
  const collisions = classifyIngredientAliasCollisions([...comparisonCatalog, proposal]);
  const warnings = [];

  for (const collision of collisions) {
    if (!UX_COLLISION_TYPES.has(collision.collisionType)) continue;
    const proposedParticipants = collision.participants.filter((item) => item.ingredientId === proposalId);
    if (proposedParticipants.length === 0) continue;

    let proposedSources;
    if (collision.collisionType === 'SELF_ALIAS_TO_CANONICAL') {
      proposedSources = ['alias'];
    } else if (collision.collisionType === 'ALIAS_TO_ALIAS') {
      proposedSources = ['alias'];
    } else {
      proposedSources = [...new Set(proposedParticipants.map((item) => item.source))];
    }

    for (const source of proposedSources) {
      const display = displays.get(`${collision.normalizedValue}:${source}`);
      if (!display) continue;
      const owners = new Map();
      for (const participant of collision.participants) {
        if (participant.ingredientId === proposalId) continue;
        if (collision.collisionType === 'ALIAS_TO_CANONICAL' && participant.source === source) continue;
        const key = participant.ingredientId;
        if (!owners.has(key)) {
          owners.set(key, {
            ingredientName: participant.canonicalName,
            status: participant.status,
            matchedOn: participant.source,
            _id: key,
          });
        }
      }
      const conflicts = [...owners.values()]
        .sort((left, right) => compareText(left.ingredientName, right.ingredientName) || compareText(left._id, right._id));
      if (collision.collisionType !== 'SELF_ALIAS_TO_CANONICAL' && conflicts.length === 0) continue;
      const totalConflicts = conflicts.length;
      warnings.push({
        alias: display,
        collisionType: collision.collisionType,
        conflicts: conflicts.slice(0, MAX_CONFLICT_OWNERS).map(({ _id, ...conflict }) => conflict),
        totalConflicts,
        truncated: totalConflicts > MAX_CONFLICT_OWNERS,
      });
    }
  }

  const displayOrder = [...displays.values()];
  return warnings.sort((left, right) =>
    (displayOrder.indexOf(left.alias) - displayOrder.indexOf(right.alias)) ||
    (ALIAS_COLLISION_TYPE_ORDER[left.collisionType] - ALIAS_COLLISION_TYPE_ORDER[right.collisionType])
  );
}

module.exports = {
  ALIAS_COLLISION_TYPES,
  normalizeIngredientName,
  ingredientAliasStatus,
  classifyIngredientAliasCollisions,
  summarizeIngredientAliasCollisions,
  classifyProposedIngredientAliasWarnings,
};
