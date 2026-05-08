import {BasketIcon} from '@sanity/icons'
import {defineField, defineType} from 'sanity'

export const order = defineType({
  name: 'order',
  title: 'Order (Agent-Aware)',
  type: 'document', 
  icon: BasketIcon,
  groups: [
    { name: 'customer', title: 'Customer Profile' },
    { name: 'items', title: 'Items & Invoice' },
    { name: 'agent', title: 'AI Agent Automation' },
  ],
  preview: {
    select: {
      title: 'customerName',
      status: 'status',
      totalAmount: 'totalAmount',
      txHash: 'transactionHash',
    },
    prepare({ title, status, totalAmount, txHash }: any) {
      const amount = typeof totalAmount === 'number' ? totalAmount : 0
      const marker = txHash ? '⛓️ On-chain' : '📄 Off-chain'
      return {
        title: title || 'Unnamed order',
        subtitle: `${String(status || 'pending').toUpperCase()} • ${amount} • ${marker}`,
      }
    },
  },
  fields: [
    defineField({
      name: 'customerName',
      title: 'Customer Name',
      type: 'string',
      group: 'customer',
      validation: (Rule: any) => Rule.required(),
    }),
    defineField({
      name: 'customerEmail',
      title: 'Customer Email',
      type: 'string',
      group: 'customer',
      validation: (Rule: any) => Rule.required().email(),
    }),
    defineField({
      name: 'items',
      title: 'Items',
      type: 'array',
      group: 'items',
      validation: (Rule: any) => Rule.required().min(1),
      of: [
        {
          type: 'object',
          fields: [
            {
              name: 'product',
              type: 'reference',
              to: [{type: 'product'}],
              validation: (Rule: any) => Rule.required(),
            },
            {
              name: 'quantity',
              type: 'number',
              validation: (Rule: any) => Rule.required().integer().min(1),
            },
            {
              name: 'price',
              type: 'number',
              title: 'Price at purchase ($KITE)',
              validation: (Rule: any) => Rule.required().min(0),
            }
          ],
          preview: {
            select: {
              productName: 'product.name',
              quantity: 'quantity',
            },
            prepare({ productName, quantity }: any) {
              return {
                title: productName || 'Product',
                subtitle: `Quantity: ${quantity || 0}`,
              }
            },
          },
        }
      ]
    }),
    defineField({
      name: 'totalAmount',
      title: 'Total Amount ($KITE)',
      type: 'number',
      group: 'items',
      validation: (Rule: any) => Rule.required().min(0),
    }),
    defineField({
      name: 'status',
      title: 'Order Status',
      type: 'string',
      group: 'items',
      options: {
        list: [
          {title: 'Pending', value: 'pending'},
          {title: 'Processing', value: 'processing'},
          {title: 'Shipped', value: 'shipped'},
          {title: 'Delivered', value: 'delivered'},
          {title: 'Cancelled', value: 'cancelled'},
        ],
      },
      initialValue: 'pending',
      validation: (Rule: any) => Rule.required(),
    }),
    defineField({
      name: 'agentAssisted',
      title: 'AI Agent Assisted',
      type: 'boolean',
      group: 'agent',
      initialValue: false,
      description: 'Flag for M2M (Machine-to-Machine) commerce tracking.',
    }),
    defineField({
      name: 'agentId',
      title: 'Agent Identifier',
      type: 'string',
      group: 'agent',
      hidden: ({ parent }: any) => !parent?.agentAssisted,
    }),
    defineField({
      name: 'buyerWalletAddress',
      title: 'Buyer Wallet Address',
      type: 'string',
      group: 'agent',
      description: 'Address used for smart contract execution.',
      hidden: ({ parent }: any) => !parent?.agentAssisted,
      validation: (Rule: any) => Rule.regex(/^0x[a-fA-F0-9]{40}$/, { name: 'EVM address' }).optional(),
    }),
    defineField({
      name: 'transactionHash',
      title: 'Blockchain Tx Hash',
      type: 'string',
      group: 'agent',
      description: 'Proof of payment on the Kite network (settleOrder receipt).',
      hidden: ({ parent }: any) => !parent?.agentAssisted,
      validation: (Rule: any) =>
        Rule.regex(/^0x[a-fA-F0-9]{64}$/, { name: '0x-prefixed 32-byte hash' }).optional(),
    }),
    defineField({
      name: 'onChainOrderId',
      title: 'On-chain Order ID',
      type: 'string',
      group: 'agent',
      description: 'L402 orderId echoed in the PurchaseAttested event. Pairs with transactionHash for reconciliation.',
      hidden: ({ parent }: any) => !parent?.agentAssisted,
    }),
    defineField({
      name: 'negotiationTranscript',
      title: 'Negotiation Transcript',
      type: 'array',
      group: 'agent',
      of: [{ type: 'text' }],
      description: 'Log of the haggle protocol exchange between buyer agent and store agent.',
      hidden: ({ parent }: any) => !parent?.agentAssisted,
    })
  ]
})
