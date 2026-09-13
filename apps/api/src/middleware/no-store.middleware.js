// Marks a response as never cacheable. Applied only to routes whose
// successful response carries authentication/session/current-user data
// (fresh tokens or the account object) — never globally — so neither a
// shared cache nor a browser back/forward cache retains that response.
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

module.exports = { noStore };
