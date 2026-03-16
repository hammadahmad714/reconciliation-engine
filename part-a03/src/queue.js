const { Queue } = require("bullmq");

function createQueue(name, connection) {
  return new Queue(name, { connection });
}

module.exports = {
  createQueue
};

