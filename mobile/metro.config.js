const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('glb', 'gltf', 'png', 'jpg');
config.resolver.sourceExts.push('mjs');

module.exports = config;
