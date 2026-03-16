function defaultPolicy() {
  return {
    expectedLocale: "en-US",
    expectedTimezone: "America/Los_Angeles",
    allowedIpCountry: "US",
    datacenterOrgHints: [
      "Amazon",
      "AWS",
      "Google",
      "DigitalOcean",
      "Hetzner",
      "OVH",
      "Cloud",
      "Hosting",
      "Data Center",
      "Datacenter"
    ],
    allowedMcc: ["310", "311", "312", "313", "314", "315", "316"],
    backgroundLocationPackages: [],
    targetPackage: "com.example.app"
  };
}

module.exports = {
  defaultPolicy
};

