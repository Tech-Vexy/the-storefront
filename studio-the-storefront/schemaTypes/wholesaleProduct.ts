import {defineField, defineType} from 'sanity'
import {PackageIcon} from '@sanity/icons'

export const wholesaleProduct = defineType({
  name: 'wholesaleProduct',
  title: 'Wholesale Catalog Item',
  type: 'document',
  icon: PackageIcon,
  fields: [
    defineField({
      name: 'name',
      title: 'Product Name',
      type: 'string',
    }),
    defineField({
      name: 'sku',
      title: 'SKU',
      type: 'string',
      validation: (Rule: any) => Rule.required(),
    }),
    defineField({
      name: 'bulkPrice',
      title: 'Bulk Price ($KITE)',
      type: 'number',
    }),
    defineField({
      name: 'minOrder',
      title: 'Minimum Order Quantity',
      type: 'number',
    }),
    defineField({
      name: 'stock',
      title: 'Available Stock',
      type: 'number',
    }),
  ],
  preview: {
    select: {
      title: 'name',
      sku: 'sku',
      price: 'bulkPrice',
      stock: 'stock',
    },
    prepare({title, sku, price, stock}) {
      return {
        title: title,
        subtitle: `${sku} | ${price} KITE | Stock: ${stock}`,
      }
    },
  },
})
