export type ProductStatus = 'active' | 'preorder' | 'discontinued'

export interface HardwareSpec {
  property: string
  value: string
}

export interface NegotiationRules {
  isNegotiable?: boolean
  floorPrice?: number
  maxDiscountPercentage?: number
}

export interface ProductInventory {
  _id: string
  name: string
  sku: string
  stock: number
  price: number
  status: ProductStatus
}

export interface ProductDashboard {
  _id: string
  name: string
  sku: string
  stock: number
  price: number
  status: ProductStatus
  hardwareSpecs?: HardwareSpec[]
}

export interface ProductSearchResult {
  name: string
  sku: string
  price: number
  machineDescription?: string
  hardwareSpecs?: HardwareSpec[]
  negotiationRules?: NegotiationRules
  status: ProductStatus
}
