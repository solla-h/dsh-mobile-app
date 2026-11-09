const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

// Android otherwise blocks the documented LAN/Tailscale/USB ws:// connections.
// Public cleartext endpoints remain rejected by src/protocol/pairing.ts.
module.exports = function withPrivateNetworkTraffic(config) {
  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
};
