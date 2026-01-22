# Monsoon Fire Portal - Materials Catalog Schema

Collection: `materialsProducts`

## Purpose
Defines the products available for pickup-only supply purchases. Each document represents a single SKU or variant.

## Fields
- `name` (string, required)
- `description` (string | null)
- `category` (string | null) - e.g. "Clays", "Glaze Supplies", "Studio Add-ons"
- `sku` (string | null)
- `priceCents` (number, required) - integer cents
- `currency` (string, default "USD")
- `stripePriceId` (string | null) - optional; if present, Checkout uses Stripe Price instead of inline pricing
- `imageUrl` (string | null)
- `trackInventory` (boolean, default false)
- `inventoryOnHand` (number | null) - only used if `trackInventory` is true
- `inventoryReserved` (number | null) - reserved stock (currently unused; reserved logic is deferred)
- `active` (boolean, default true)
- `createdAt` (Timestamp)
- `updatedAt` (Timestamp)

## Inventory rules
- If `trackInventory` is true, checkout blocks quantities exceeding `inventoryOnHand - inventoryReserved`.
- If `trackInventory` is false, checkout is soft (no stock enforcement).

## Example
```json
{
  "name": "Laguna WC-401 B-Mix Cone 5/6 (25 lb)",
  "description": "Smooth, white body for mid-fire porcelain-style work.",
  "category": "Clays",
  "sku": "LAGUNA_BMIX_5_25",
  "priceCents": 4000,
  "currency": "USD",
  "stripePriceId": null,
  "imageUrl": null,
  "trackInventory": true,
  "inventoryOnHand": 40,
  "inventoryReserved": 0,
  "active": true,
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}
```

## Local seeding
- Script: `functions/scripts/seedMaterials.js`
- Run from repo root:
  - `node functions/scripts/seedMaterials.js`

The seed script writes two sample products into `materialsProducts` for emulator testing.

## Notes
- Firestore rejects `undefined`; omit fields or use `null`.
- Products are currently created via the `seedMaterialsCatalog` admin function, the seed script, or manual writes.
