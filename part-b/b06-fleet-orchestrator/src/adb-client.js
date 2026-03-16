class AdbClient {
  constructor(adapter) {
    this.adapter = adapter;
  }

  async ping(deviceId) {
    return this.adapter.ping(deviceId);
  }

  async echo(deviceId) {
    return this.adapter.exec(deviceId, ["shell", "echo", "ping"]);
  }

  async runScript(deviceId, androidVersion, scriptName) {
    return this.adapter.runScript(deviceId, androidVersion, scriptName);
  }
}

module.exports = {
  AdbClient
};

