function isSupportWindowOpen(now, policy) {
  const localHour = (now.getUTCHours() + (policy.tzOffsetHours || 0) + 24) % 24;
  const start = policy.supportWindow.startHour;
  const end = policy.supportWindow.endHour;
  if (start <= end) return localHour >= start && localHour < end;
  return localHour >= start || localHour < end;
}

function isDeviceRisky(device) {
  return device.connection_quality !== "good" || Number(device.android_version) < 10;
}

function failureRate(failures, total) {
  if (!total) return 0;
  return failures / total;
}

function shouldScaleUp(globalStats, policy) {
  return failureRate(globalStats.failures, globalStats.completed) < policy.maxFailureRate;
}

module.exports = {
  isSupportWindowOpen,
  isDeviceRisky,
  failureRate,
  shouldScaleUp
};

