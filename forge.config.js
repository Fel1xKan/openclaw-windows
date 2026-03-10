const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const fs = require('fs-extra');

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'OpenClaw',
    afterExtract: [
      async (extractPath, electronVersion, platform, arch, done) => {
        // Copy packages/openclaw manually without dereferencing symlinks
        // to massively speed up packaging and avoid symlink loops.
        // During afterExtract, the mac app is always named "Electron.app" before rename.
        const dest = platform === 'darwin'
          ? path.join(extractPath, 'Electron.app', 'Contents', 'Resources', 'openclaw')
          : path.join(extractPath, 'resources', 'openclaw');

        try {
          await fs.copy(path.resolve(__dirname, 'packages/openclaw'), dest, { dereference: false });
          done();
        } catch (err) {
          done(err);
        }
      }
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'OpenClaw',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/main.js',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    // Fuses configuration
    // NOTE: RunAsNode MUST be enabled for spawning the gateway child process
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};
