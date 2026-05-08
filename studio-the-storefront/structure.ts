import {
  ActivityIcon,
  BasketIcon,
  CogIcon,
  PackageIcon,
  RobotIcon,
  TagIcon,
  UsersIcon,
} from '@sanity/icons'

export const structure = (S: any) =>
  S.list()
    .title('Storefront Control Center')
    .items([
      // --- Inventory ---
      S.listItem()
        .title('Storefront Inventory')
        .icon(PackageIcon)
        .child(
          S.list()
            .title('Inventory')
            .items([
              S.documentTypeListItem('product').title('Products').icon(RobotIcon),
              S.documentTypeListItem('category').title('Categories').icon(TagIcon),
            ])
        ),

      S.divider(),

      // --- Swarm Operations ---
      S.listItem()
        .title('Swarm Operations')
        .icon(ActivityIcon)
        .child(
          S.list()
            .title('Operations')
            .items([
              S.documentTypeListItem('order').title('Orders').icon(BasketIcon),
              S.documentTypeListItem('swarmLog').title('Live Activity Logs').icon(ActivityIcon),
              S.documentTypeListItem('reputation').title('Entity Reputation').icon(UsersIcon),
              S.documentTypeListItem('agentRegistry').title('Agent Registry').icon(RobotIcon),
              S.documentTypeListItem('budgetLedger').title('Budget Ledger').icon(ActivityIcon),
            ])
        ),

      S.divider(),

      // --- Wholesale ---
      S.listItem()
        .title('Wholesale Supply')
        .icon(PackageIcon)
        .child(
          S.list()
            .title('Wholesale')
            .items([
              S.documentTypeListItem('wholesaleProduct').title('Supplier Catalog').icon(PackageIcon),
            ])
        ),

      S.divider(),

      // --- Settings ---
      S.listItem()
        .title('Global Settings')
        .icon(CogIcon)
        .child(
          S.document()
            .schemaType('agentConfig')
            .documentId('global-config') // Singleton-like behavior
        ),
      
      // Filter out types that are already included in the custom structure
      ...S.documentTypeListItems().filter(
        (listItem: any) =>
          !['product', 'category', 'order', 'swarmLog', 'reputation', 'wholesaleProduct', 'agentConfig', 'agentRegistry', 'budgetLedger'].includes(
            listItem.getId()
          )
      ),
    ])
