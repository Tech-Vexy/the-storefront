import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: '75fz8bzj',
    dataset: 'production'
  },
  deployment: {
    /**
     * Enable auto-updates for studios.
     * Learn more at https://www.sanity.io/docs/studio/latest-version-of-sanity#k47faf43faf56
     */
    appId: 'c7sb3auvf2nzcoddjpvk6rzm', // This is the default appId for Sanity-managed deployments. You can change it if you have your own deployment setup.
    autoUpdates: true,
  }
})
