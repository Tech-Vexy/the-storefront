import {RobotIcon} from '@sanity/icons'
import {defineField, defineType} from 'sanity'

export const agentRegistry = defineType({
  name: 'agentRegistry',
  title: 'Agent Registry',
  type: 'document',
  icon: RobotIcon,
  groups: [
    { name: 'identity', title: 'Identity & Credentials' },
    { name: 'escrow', title: 'On-Chain Escrow' },
    { name: 'policy', title: 'Off-chain Policy' },
    { name: 'lifecycle', title: 'Lifecycle & Contract' },
  ],
  preview: {
    select: {
      title: 'agentId',
      subtitleStatus: 'status',
      subtitleWallet: 'walletAddress',
    },
    prepare({title, subtitleStatus, subtitleWallet}: any) {
      const status = subtitleStatus ? String(subtitleStatus).toUpperCase() : 'UNKNOWN'
      const wallet = subtitleWallet ? `${subtitleWallet.slice(0, 6)}…${subtitleWallet.slice(-4)}` : 'no-wallet'
      return {
        title: title || 'Unregistered agent',
        subtitle: `${status} • ${wallet}`,
      }
    },
  },
  fields: [
    defineField({
      name: 'agentId',
      title: 'Agent ID',
      type: 'string',
      group: 'identity',
      description: 'Unique identifier matching the bytes32 key in AgentTreasury. Hashed to bytes32 on-chain via keccak256.',
      validation: (Rule: any) =>
        Rule.required()
          .min(3)
          .max(64)
          .regex(/^[a-z0-9-]+$/, {name: 'lowercase alphanumeric + hyphen'})
          .custom(async (id: string, context: any) => {
            if (!id) return true
            const docId = context.document?._id?.replace(/^drafts\./, '')
            const dupe = await context
              .getClient({apiVersion: '2024-01-01'})
              .fetch(
                `count(*[_type == "agentRegistry" && agentId == $id && !(_id in [$docId, "drafts." + $docId])])`,
                {id, docId},
              )
            return dupe > 0 ? 'agentId must be unique' : true
          }),
    }),
    defineField({
      name: 'ownerAddress',
      title: 'Owner EOA',
      type: 'string',
      group: 'identity',
      description: 'Address allowed to deposit/withdraw and update policy on the Treasury.',
      validation: (Rule: any) => Rule.required().regex(/^0x[a-fA-F0-9]{40}$/, {name: 'EVM address'}),
    }),
    defineField({
      name: 'walletAddress',
      title: 'Agent Wallet',
      type: 'string',
      group: 'identity',
      description: 'EOA the agent process signs spend(...) calls from.',
      validation: (Rule: any) => Rule.required().regex(/^0x[a-fA-F0-9]{40}$/, {name: 'EVM address'}),
    }),
    defineField({
      name: 'passportId',
      title: 'Kite Passport ID',
      type: 'string',
      group: 'identity',
      description: 'Auto-authenticated on the attestation contract during registerAgent.',
      validation: (Rule: any) => Rule.required().min(8).max(128),
    }),
    defineField({
      name: 'dailyCap',
      title: 'Daily Cap ($KITE)',
      type: 'number',
      group: 'escrow',
      description: 'Max spend in a rolling 24h window. Enforced on-chain.',
      validation: (Rule: any) => Rule.required().min(0).precision(18),
    }),
    defineField({
      name: 'perTxCap',
      title: 'Per-Transaction Cap ($KITE)',
      type: 'number',
      group: 'escrow',
      description: 'Hard upper bound on a single spend(...) call.',
      validation: (Rule: any) => Rule.required().min(0).precision(18),
    }),
    defineField({
      name: 'policyJson',
      title: 'Off-chain Policy',
      type: 'object',
      group: 'policy',
      description: 'Hashed (keccak256 of canonical JSON) and bound to the agent on-chain. Mismatch blocks spend.',
      fields: [
        {
          name: 'vendorAllowlist',
          title: 'Vendor Allowlist (addresses)',
          type: 'array',
          of: [{type: 'string'}],
          description: 'Recipients the agent may pay. Empty list = no constraint enforced off-chain (Treasury still gates).',
        },
        {
          name: 'categoryLimits',
          title: 'Per-category Spend Caps',
          type: 'array',
          of: [
            {
              type: 'object',
              fields: [
                {name: 'category', type: 'string', title: 'Category'},
                {name: 'maxKite', type: 'number', title: 'Max $KITE'},
              ],
              preview: {select: {title: 'category', subtitle: 'maxKite'}},
            },
          ],
        },
        {
          name: 'maxNegotiationRounds',
          title: 'Max Negotiation Rounds',
          type: 'number',
          initialValue: 3,
          validation: (Rule: any) => Rule.min(0).max(20).integer(),
        },
      ],
    }),
    defineField({
      name: 'stakeKite',
      title: 'Stake ($KITE)',
      type: 'number',
      group: 'escrow',
      description: 'Bond posted at registerAgent time. Reclaimable on deregistration.',
      validation: (Rule: any) => Rule.min(0).precision(18),
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'lifecycle',
      options: {
        list: [
          {title: 'Active', value: 'active'},
          {title: 'Frozen', value: 'frozen'},
          {title: 'Deregistered', value: 'deregistered'},
        ],
        layout: 'radio',
      },
      initialValue: 'active',
      validation: (Rule: any) => Rule.required(),
    }),
    defineField({
      name: 'treasuryAddress',
      title: 'Treasury Contract',
      type: 'string',
      group: 'lifecycle',
      description: 'Address of the AgentTreasury this agent is registered against.',
      validation: (Rule: any) => Rule.regex(/^0x[a-fA-F0-9]{40}$/, {name: 'EVM address'}),
    }),
  ],
})
