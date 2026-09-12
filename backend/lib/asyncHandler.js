// Express 4 does not forward a rejected async handler's promise to the error
// middleware — an unhandled rejection there crashes the whole process. This
// wrapper catches it and forwards to next() so app.use((err,...)) actually runs.
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
