class AlertService {
  constructor() {
    this.events = [];
  }

  async emit(event) {
    this.events.push({ ...event, at: new Date() });
  }
}

module.exports = {
  AlertService
};

