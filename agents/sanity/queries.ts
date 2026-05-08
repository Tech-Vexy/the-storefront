export const ACTIVE_PRODUCT_FILTER = '_type == "product" && status in ["active", "preorder"]'

export const PRODUCT_INVENTORY_PROJECTION   = '{_id, name, sku, stock, price, status}'
export const PRODUCT_DASHBOARD_PROJECTION   = '{_id, name, sku, stock, price, hardwareSpecs, status}'
export const PRODUCT_SEARCH_PROJECTION      = '{name, sku, price, machineDescription, hardwareSpecs, negotiationRules, status}'
export const PRODUCT_CHECKOUT_PROJECTION    = '{_id, sku, price, stock}'

export const LIST_ACTIVE_PRODUCTS_QUERY =
  `*[${ACTIVE_PRODUCT_FILTER}] | order(stock asc, name asc) ${PRODUCT_INVENTORY_PROJECTION}`

export const DASHBOARD_PRODUCTS_QUERY =
  `*[_type == "product"] | order(name asc) ${PRODUCT_DASHBOARD_PROJECTION}`

export const SEARCH_ACTIVE_PRODUCTS_QUERY =
  `*[${ACTIVE_PRODUCT_FILTER} && stock > 0 && (name match $search || machineDescription match $search)][0...5]${PRODUCT_SEARCH_PROJECTION}`

export const SEARCH_ACTIVE_PRODUCTS_PAGED_QUERY =
  `*[${ACTIVE_PRODUCT_FILTER} && stock > 0 && (name match $search || machineDescription match $search)] | order(name asc)[$from...$to]${PRODUCT_SEARCH_PROJECTION}`

export const COUNT_SEARCH_ACTIVE_PRODUCTS_QUERY =
  `count(*[${ACTIVE_PRODUCT_FILTER} && stock > 0 && (name match $search || machineDescription match $search)])`

export const ACTIVE_PRODUCT_BY_SKU_FOR_CHECKOUT_QUERY =
  `*[${ACTIVE_PRODUCT_FILTER} && sku == $sku][0]${PRODUCT_CHECKOUT_PROJECTION}`
