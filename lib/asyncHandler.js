// Express fängt Fehler aus async-Handlern nicht automatisch ab (Stand Express 4) —
// ohne diesen Wrapper würde ein Datenbankfehler eine hängende Anfrage statt einer
// sauberen 500er-Antwort erzeugen.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
