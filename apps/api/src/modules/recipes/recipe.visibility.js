// A missing publicationStatus is the explicit compatibility state for
// legacy recipes that retain Published consumer semantics.
function consumerPublicationFilter() {
  return {
    $or: [
      { publicationStatus: 'published' },
      { publicationStatus: { $exists: false } },
    ],
  };
}

module.exports = { consumerPublicationFilter };
