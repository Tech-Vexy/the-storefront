import {defineField, defineType} from 'sanity'
import {UsersIcon} from '@sanity/icons'

export const reputation = defineType({
  name: 'reputation',
  title: 'Entity Reputation',
  type: 'document',
  icon: UsersIcon,
  fields: [
    defineField({
      name: 'entityId',
      title: 'Entity ID (URL or Identifier)',
      type: 'string',
      validation: (Rule: any) => Rule.required(),
    }),
    defineField({
      name: 'score',
      title: 'Reputation Score',
      type: 'number',
      initialValue: 100,
      validation: (Rule: any) => Rule.min(0).max(100),
    }),
    defineField({
      name: 'successfulOrders',
      title: 'Successful Orders',
      type: 'number',
      initialValue: 0,
    }),
    defineField({
      name: 'failedOrders',
      title: 'Failed Orders',
      type: 'number',
      initialValue: 0,
    }),
    defineField({
      name: 'lastUpdated',
      title: 'Last Updated',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
    }),
  ],
  preview: {
    select: {
      title: 'entityId',
      score: 'score',
      success: 'successfulOrders',
      failed: 'failedOrders',
    },
    prepare({title, score, success, failed}) {
      return {
        title: `${title}`,
        subtitle: `Score: ${score}/100 | ✅ ${success} | ❌ ${failed}`,
      }
    },
  },
})
