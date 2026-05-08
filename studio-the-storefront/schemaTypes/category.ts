import {TagIcon} from '@sanity/icons'
import {defineField, defineType} from 'sanity'

export const category = defineType({
  name: 'category',
  title: 'Category (Semantic)',
  type: 'document', icon: TagIcon,
  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name' },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
      description: 'Used by agents to understand the scope of products in this category.',
    }),
    defineField({
      name: 'synonyms',
      title: 'Semantic Synonyms',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Keywords and phrases that help the agent router map user intent to this category.',
      options: { layout: 'tags' },
    })
  ],
})
