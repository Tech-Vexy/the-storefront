export interface ProductSearchResult {
  name: string
  sku: string
  price: number
  stock?: number
  machineDescription?: string
  hardwareSpecs?: { property: string; value: string }[]
  negotiationRules?: {
    isNegotiable?: boolean
    floorPrice?: number
    maxDiscountPercentage?: number
  }
  status?: 'active' | 'preorder' | 'discontinued'
}

export interface CatalogSearchParams {
  query?: string
  page?: number
  pageSize?: number
}

export interface CatalogSearchPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface CatalogSearchEnvelope {
  items: ProductSearchResult[]
  pagination: CatalogSearchPagination
}

export interface CheckoutRequestBody {
  sku: string
  quantity?: number
}

export interface PaymentRequiredAccept {
  scheme: 'L402'
  chain: 'kite-testnet'
  chainId: 2368
  contract: string
  payTo: string
  passportId: string
  orderId: string
  /** Canonical settlement value in wei (decimal-string of bigint). Use this for math. */
  amountWei: string
  /** Display-only decimal KITE. Do not use for math. */
  amount: string
  currency: 'KITE'
  expiresAt: string
}

export interface PaymentRequiredResponse {
  error: 'Payment Required'
  accepts: PaymentRequiredAccept[]
  message: string
}

export interface PaymentProof {
  txHash: string
  payer: string
  orderId: string
}

export interface CheckoutSuccessResponse {
  status: 'fulfilled'
  orderId: string
  sku: string
  quantity: number
  txHash: string
  message: string
}

export interface OrderRecord {
  orderId: string
  sku: string
  quantity: number
  /** Canonical quoted amount in wei. */
  amountWei: string
  /** Display-only decimal KITE. */
  amount: string
  /** Actual amount settled on-chain (from PurchaseAttested.amountPaidWei). Set on fulfillment. */
  paidWei?: string
  status: 'pending' | 'fulfilled' | 'expired'
  createdAt: string
  expiresAt: string
  txHash?: string
  payer?: string
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown }
}
