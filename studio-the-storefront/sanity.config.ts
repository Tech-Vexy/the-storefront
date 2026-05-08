import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {structure} from './structure'

export default defineConfig({
  name: 'default',
  title: 'The StoreFront',

  projectId: '75fz8bzj',
  dataset: 'production',

  plugins: [structureTool({structure}), visionTool()],

  schema: {
    types: schemaTypes,
    // Filter out the singleton config document from "Create New" menu templates
    templates: (prev) =>
      prev.filter((template) => template.schemaType !== 'agentConfig'),
  },

  document: {
    // For singleton documents, prevent actions that could delete or corrupt global config state
    actions: (prev, { schemaType }) => {
      if (schemaType === 'agentConfig') {
        return prev.filter(
          ({ action }) => action && !['duplicate', 'delete', 'unpublish'].includes(action)
        )
      }
      return prev
    },
  },
})
