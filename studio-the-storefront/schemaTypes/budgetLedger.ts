import {ActivityIcon} from '@sanity/icons'
import {defineField, defineType} from 'sanity'

export const budgetLedger = defineType({
  name: 'budgetLedger',
  title: 'Agent Budget Ledger',
  type: 'document',
  icon: ActivityIcon,
  preview: {
    select: {
      title: 'orderId',
      subtitleKind: 'kind',
      subtitleAmount: 'amountKite',
      subtitleAgent: 'agentId.agentId',
      timestamp: 'timestamp',
    },
    prepare({title, subtitleKind, subtitleAmount, subtitleAgent, timestamp}: any) {
      const t = timestamp ? new Date(timestamp).toLocaleString() : ''
      return {
        title: `${subtitleKind || 'entry'}: ${subtitleAmount ?? '?'} KITE`,
        subtitle: `${subtitleAgent || 'unknown agent'} • ${title || ''} • ${t}`,
      }
    },
  },
  fields: [
    defineField({
      name: 'agentId',
      title: 'Agent',
      type: 'reference',
      to: [{type: 'agentRegistry'}],
      validation: (Rule: any) => Rule.required(),
    }),
    defineField({
      name: 'orderId',
      title: 'Order ID',
      type: 'string',
      description: 'Idempotency key passed to AgentTreasury.spend.',
    }),
    defineField({
      name: 'kind',
      title: 'Entry Kind',
      type: 'string',
      options: {
        list: [
          {title: 'Spend', value: 'spend'},
          {title: 'Deposit', value: 'deposit'},
          {title: 'Withdraw', value: 'withdraw'},
          {title: 'Freeze', value: 'freeze'},
          {title: 'Unfreeze', value: 'unfreeze'},
          {title: 'Failed', value: 'failed'},
        ],
        layout: 'dropdown',
      },
      validation: (Rule: any) => Rule.required(),
    }),
    defineField({
      name: 'amountWei',
      title: 'Amount (wei)',
      type: 'string',
      description: 'Stored as decimal string to preserve uint256 precision.',
    }),
    defineField({
      name: 'amountKite',
      title: 'Amount ($KITE)',
      type: 'number',
      description: 'Display value derived from amountWei.',
      validation: (Rule: any) => Rule.min(0).precision(18),
    }),
    defineField({
      name: 'recipient',
      title: 'Recipient',
      type: 'string',
      validation: (Rule: any) => Rule.regex(/^0x[a-fA-F0-9]{40}$/, {name: 'EVM address'}),
    }),
    defineField({
      name: 'txHash',
      title: 'Transaction Hash',
      type: 'string',
      validation: (Rule: any) => Rule.regex(/^0x[a-fA-F0-9]{64}$/, {name: 'tx hash'}),
    }),
    defineField({
      name: 'policyHashAtSpend',
      title: 'Policy Hash At Spend',
      type: 'string',
      description: 'bytes32 of the agent policy at the moment of this entry. Detects policy drift.',
    }),
    defineField({
      name: 'timestamp',
      title: 'Timestamp',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
    }),
  ],
})
