import {CogIcon} from '@sanity/icons'
import {defineField, defineType} from 'sanity'

export const agentConfig = defineType({
  name: 'agentConfig',
  title: 'Global Agent Config',
  type: 'document', icon: CogIcon,
  fields: [
    defineField({
      name: 'storePolicyPrompt',
      title: 'Global Store Policy (System Prompt)',
      type: 'text',
      description:
        'Base instructions injected into all store agent system prompts (e.g., return policies, shipping zones). Read by storeManager at startup via SANITY_AGENT_CONFIG_ID.',
    }),
    defineField({
      name: 'allowNegotiation',
      title: 'Global Negotiation Killswitch',
      type: 'boolean',
      initialValue: true,
      description:
        'Set to false to instantly reject all haggling requests store-wide. Checked by storeManager on every /negotiate call.',
    }),
    defineField({
      name: 'baseHaggleStrategy',
      title: 'Base Haggle Strategy',
      type: 'text',
      description:
        'Default personality/strategy appended to the negotiation system prompt. Overrides the hardcoded default when present.',
      initialValue: 'Professional but firm. Allow up to 10% discount for bulk orders without further approval.',
    }),
    defineField({
      name: 'humanHandoverWebhook',
      title: 'Human Handover Webhook',
      type: 'url',
      description:
        'POST endpoint called by the agent when sentiment drops below threshold or negotiation rules are exhausted. Payload: { orderId, sku, transcript }.',
    }),
    defineField({
      name: 'agentModel',
      title: 'Preferred Agent Model',
      type: 'string',
      description:
        'Model identifier passed to the LangGraph runtime. Must match a model available to the configured provider. Agents fall back to llama-3.3-70b-versatile if unset.',
      options: {
        list: [
          {title: 'Llama 3.3 70B (Groq)', value: 'llama-3.3-70b-versatile'},
          {title: 'Llama 3.1 8B Instant (Groq)', value: 'llama-3.1-8b-instant'},
          {title: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6'},
          {title: 'Claude Opus 4.7', value: 'claude-opus-4-7'},
          {title: 'GPT-4o', value: 'gpt-4o'},
        ],
      },
      initialValue: 'llama-3.3-70b-versatile',
    }),
    defineField({
      name: 'treasuryAddress',
      title: 'AgentTreasury Contract',
      type: 'string',
      description: 'Deployed AgentTreasury address. Agents read this at startup; mismatch with TREASURY_CONTRACT env aborts boot.',
      validation: (Rule: any) => Rule.regex(/^0x[a-fA-F0-9]{40}$/, {name: 'EVM address'}),
    }),
    defineField({
      name: 'governanceAddress',
      title: 'Treasury Governance',
      type: 'string',
      description: 'Address authorised to freeze/unfreeze agents and update treasury parameters.',
      validation: (Rule: any) => Rule.regex(/^0x[a-fA-F0-9]{40}$/, {name: 'EVM address'}),
    }),
  ],
})
