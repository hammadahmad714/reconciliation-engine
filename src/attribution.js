const { toUtc } = require("./match");

function pickClient(assignments, account, postedAtUtc) {
  if (!account || !postedAtUtc) return null;
  const ts = new Date(postedAtUtc).getTime();
  const relevant = assignments.filter((a) => a.account === account);
  let winner = null;
  for (const a of relevant) {
    const from = new Date(toUtc(a.from)).getTime();
    const to = a.to ? new Date(toUtc(a.to)).getTime() : Infinity;
    if (ts >= from && ts < to) {
      if (!winner || from > new Date(toUtc(winner.from)).getTime()) {
        winner = a;
      }
    }
  }
  return winner ? winner.client : null;
}

module.exports = {
  pickClient
};

