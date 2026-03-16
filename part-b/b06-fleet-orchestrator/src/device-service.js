class DeviceService {
  constructor(client) {
    this.client = client;
  }

  async fetchDevices() {
    const list = await this.client.listDevices();
    return list.map((d) => ({
      deviceId: d.device_id,
      androidVersion: d.android_version,
      currentTask: d.current_task,
      connectionQuality: d.connection_quality,
      lastHeartbeat: new Date(d.last_heartbeat)
    }));
  }
}

module.exports = {
  DeviceService
};

