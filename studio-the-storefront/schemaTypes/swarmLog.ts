import {defineField, defineType} from 'sanity'
import {ActivityIcon} from '@sanity/icons'

export const swarmLog = defineType({
  name: 'swarmLog',
  title: 'Swarm Activity Log',
  type: 'document',
  icon: ActivityIcon,
  fields: [
    defineField({
      name: 'timestamp',
      title: 'Timestamp',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
    }),
    defineField({
      name: 'agent',
      title: 'Agent Name',
      type: 'string',
    }),
    defineField({
      name: 'message',
      title: 'Log Message',
      type: 'text',
    }),
    defineField({
      name: 'type',
      title: 'Log Type',
      type: 'string',
      options: {
        list: [
          {title: 'Info', value: 'info'},
          {title: 'Success', value: 'success'},
          {title: 'Warning', value: 'warning'},
          {title: 'Error', value: 'error'},
          {title: 'Economic', value: 'economic'},
        ],
      },
    }),
    defineField({
      name: 'requestId',
      title: 'Request ID',
      type: 'string',
    }),
  ],
  preview: {
    select: {
      title: 'message',
      subtitle: 'agent',
      type: 'type',
      timestamp: 'timestamp',
    },
    prepare({title, subtitle, type, timestamp}) {
      const icons: Record<string, string> = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '🚨',
        economic: '💰',
      }
      return {
        title: `${icons[type] || '📝'} ${title}`,
        subtitle: `${subtitle} | ${new Date(timestamp).toLocaleTimeString()}`,
      }
    },
  },
})
