class Dashboard {
  constructor() {
    this.devices = new Map();
  }

  setInitial(devices) {
    for (const d of devices) {
      this.devices.set(d.deviceId, {
        deviceId: d.deviceId,
        wave: null,
        androidVersion: d.androidVersion,
        status: "pending",
        preflight: null,
        execution: null,
        compliance: null,
        rollback: null
      });
    }
  }

  update(deviceId, patch) {
    const prev = this.devices.get(deviceId);
    this.devices.set(deviceId, { ...prev, ...patch });
  }

  summary() {
    const counts = {};
    for (const d of this.devices.values()) {
      counts[d.status] = (counts[d.status] || 0) + 1;
    }
    return {
      counts,
      devices: Array.from(this.devices.values())
    };
  }
}

module.exports = {
  Dashboard
};

