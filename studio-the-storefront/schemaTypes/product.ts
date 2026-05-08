import {RobotIcon} from '@sanity/icons'
import { defineField, defineType } from 'sanity'

export const product = defineType({
  name: 'product',
  title: 'Hardware Product (Agentic)',
  type: 'document', 
  icon: RobotIcon,
  groups: [
    { name: 'basic', title: 'Basic Info' },
    { name: 'pricing', title: 'Pricing & Negotiation' },
    { name: 'inventory', title: 'Inventory & Restocking' },
    { name: 'ai', title: 'AI & Metadata' },
  ],
  preview: {
    select: {
      title: 'name',
      subtitleSku: 'sku',
      subtitleStatus: 'status',
      subtitleStock: 'stock',
    },
    prepare({ title, subtitleSku, subtitleStatus, subtitleStock }: any) {
      const status = subtitleStatus ? String(subtitleStatus).toUpperCase() : 'UNKNOWN'
      const stock = typeof subtitleStock === 'number' ? subtitleStock : 'N/A'
      return {
        title: title || 'Untitled product',
        subtitle: `${subtitleSku || 'NO-SKU'} • ${status} • Stock: ${stock}`,
      }
    },
  },
  fields: [
    defineField({
      name: 'sku',
      title: 'SKU',
      type: 'string',
      group: 'basic',
      description: 'Stable, unique identifier used by agents for catalog lookup and on-chain order references. Uppercase letters, digits, and hyphens only.',
      validation: (Rule: any) =>
        Rule.required()
          .min(2)
          .max(64)
          .regex(/^[A-Z0-9-]+$/, { name: 'uppercase alphanumeric + hyphen' })
          .custom(async (sku: string, context: any) => {
            if (!sku) return true
            const id = context.document?._id?.replace(/^drafts\./, '')
            const dupe = await context.getClient({ apiVersion: '2024-01-01' }).fetch(
              `count(*[_type == "product" && sku == $sku && !(_id in [$id, "drafts." + $id])])`,
              { sku, id },
            )
            return dupe > 0 ? 'SKU must be unique across products' : true
          }),
    }),
    defineField({
      name: 'name',
      title: 'Hardware Name',
      type: 'string',
      group: 'basic',
      validation: (Rule: any) => Rule.required().min(2).max(120),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      group: 'basic',
      options: { source: 'name' },
      validation: (Rule: any) => Rule.required(),
    }),
    defineField({
      name: 'image',
      title: 'Product Image',
      type: 'image',
      group: 'basic',
      options: { hotspot: true },
    }),
    defineField({
      name: 'machineDescription',
      title: 'Machine-Readable Description',
      type: 'text',
      group: 'basic',
      description: 'Format optimized for LLM/Agent discovery and semantic indexing.',
      validation: (Rule: any) => Rule.required().min(20).max(2000),
    }),
    defineField({
      name: 'hardwareSpecs',
      title: 'Hardware Specifications (Structured)',
      type: 'array',
      group: 'ai',
      description: 'Structured data for agents to evaluate metrics (e.g. VRAM, TDP).',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'property', type: 'string', title: 'Property' },
            { name: 'value', type: 'string', title: 'Value' }
          ],
          preview: {
            select: { title: 'property', subtitle: 'value' }
          }
        }
      ],
    }),
    defineField({
      name: 'price',
      title: 'Price ($KITE)',
      type: 'number',
      group: 'pricing',
      description: 'List price in native $KITE. Up to 18 decimal places (the wei limit on Kite chain).',
      initialValue: 0.1,
      validation: (Rule: any) =>
        Rule.required()
          .min(0)
          .precision(18)
          .custom((v: number) => (Number.isFinite(v) ? true : 'Price must be a finite number')),
    }),
    defineField({
      name: 'lastCostPrice',
      title: 'Last Cost Price ($KITE)',
      type: 'number',
      group: 'pricing',
      description: 'The price paid to the supplier for the current batch. Used for margin analysis and minimum-sustainable-price floors during agent negotiation.',
      readOnly: true,
      validation: (Rule: any) => Rule.min(0).precision(18),
    }),
    defineField({
      name: 'negotiationRules',
      title: 'Agent Negotiation Logic',
      type: 'object',
      group: 'pricing',
      description: 'Parameters for the haggle protocol.',
      fields: [
        { name: 'isNegotiable', type: 'boolean', title: 'Allow Haggling', initialValue: false },
        {
          name: 'floorPrice',
          type: 'number',
          title: 'Floor Price ($KITE)',
          description: 'Hard minimum the manager agent will accept. Settlement below this is forbidden.',
          hidden: ({ parent }: any) => !parent?.isNegotiable,
          validation: (Rule: any) =>
            Rule.min(0).precision(18).custom((floor: number, context: any) => {
              if (floor === undefined || floor === null) return true
              const list = context.document?.price
              if (typeof list === 'number' && floor > list) {
                return 'Floor price cannot exceed list price'
              }
              return true
            }),
        },
        {
          name: 'maxDiscountPercentage',
          type: 'number',
          title: 'Max Discount %',
          description: '0–100. Cap on discount the manager agent may offer.',
          hidden: ({ parent }: any) => !parent?.isNegotiable,
          validation: (Rule: any) => Rule.min(0).max(100),
        },
      ],
    }),
    defineField({
      name: 'stock',
      title: 'Stock Level',
      type: 'number',
      group: 'inventory',
      description: 'Decremented atomically by the Store Manager on order fulfillment.',
      initialValue: 0,
      validation: (Rule: any) => Rule.required().integer().min(0),
    }),
    defineField({
      name: 'leadTimeDays',
      title: 'Restock Lead Time (Days)',
      type: 'number',
      group: 'inventory',
      description: 'Quoted to agents if stock is 0.',
      hidden: ({ document }: any) => ((document as any)?.stock ?? 0) > 0,
    }),
    defineField({
      name: 'restockThreshold',
      title: 'Auto-Restock Threshold',
      type: 'number',
      group: 'inventory',
      description: 'Manager auto-dispatches Buyer when stock < threshold. 0 disables auto-restock for this SKU.',
      initialValue: 0,
      validation: (Rule: any) => Rule.required().integer().min(0),
    }),
    defineField({
      name: 'reorderQty',
      title: 'Reorder Quantity',
      type: 'number',
      group: 'inventory',
      description: 'Units the auto-restock loop requests from the supplier.',
      initialValue: 1,
      validation: (Rule: any) => Rule.required().integer().min(1),
    }),
    defineField({
      name: 'preferredSupplier',
      title: 'Preferred Supplier',
      type: 'reference',
      to: [{ type: 'reputation' }],
      group: 'inventory',
      description: 'Auto-restock dispatches to this supplier first; falls back to reputation ranking on timeout.',
    }),
    defineField({
      name: 'embeddings',
      title: 'Vector Embeddings',
      type: 'array',
      of: [{ type: 'number' }],
      group: 'ai',
      readOnly: true,
      hidden: true,
      description: 'Pre-computed vectors for semantic search in Qdrant/Pinecone.',
    }),
    defineField({
      name: 'agentSalesInstructions',
      title: 'Agent Sales Instructions',
      type: 'text',
      group: 'ai',
      description: 'System prompt context injected when an agent discusses this product.',
      validation: (Rule: any) => Rule.max(2000),
    }),
    defineField({
      name: 'categories',
      title: 'Categories',
      type: 'array',
      group: 'basic',
      of: [{ type: 'reference', to: [{ type: 'category' }] }],
    }),
    defineField({
      name: 'status',
      title: 'Lifecycle Status',
      type: 'string',
      group: 'basic',
      description: 'Surfaces in /search and /negotiate responses. Discontinued products should not be sold.',
      options: {
        list: [
          { title: 'Active', value: 'active' },
          { title: 'Preorder', value: 'preorder' },
          { title: 'Discontinued', value: 'discontinued' },
        ],
        layout: 'radio',
      },
      initialValue: 'active',
      validation: (Rule: any) => Rule.required(),
    })
  ],
});
