# Monsoon Fire Portal — Materials Orders Schema

Collection: `materialsOrders`

## Purpose
Tracks checkout sessions and pickup-only supply orders created from the portal.

## Fields
- `uid` (string, required)
- `displayName` (string | null)
- `email` (string | null)
- `items` (array, required)
  - `productId` (string)
  - `name` (string)
  - `sku` (string | null)
  - `quantity` (number)
  - `unitPrice` (number)
  - `currency` (string)
  - `trackInventory` (boolean)
- `status` (string)
  - `checkout_pending` → `paid` → `picked_up`
- `totalCents` (number)
- `currency` (string)
- `pickupNotes` (string | null)
- `stripeSessionId` (string | null)
- `stripePaymentIntentId` (string | null)
- `checkoutUrl` (string | null)
- `createdAt` (Timestamp)
- `updatedAt` (Timestamp)
- `paidAt` (Timestamp | null)

## Example
```json
{
  "uid": "abc123",
  "displayName": "Micah Wyenn",
  "email": "micah@monsoonfire.com",
  "items": [
    {
      "productId": "laguna-bmix-5-25",
      "name": "Laguna WC-401 B-Mix Cone 5/6 (25 lb)",
      "sku": "LAGUNA_BMIX_5_25",
      "quantity": 2,
      "unitPrice": 4000,
      "currency": "USD",
      "trackInventory": true
    }
  ],
  "status": "checkout_pending",
  "totalCents": 8000,
  "currency": "USD",
  "pickupNotes": "Pickup Friday afternoon.",
  "stripeSessionId": "cs_test_123",
  "stripePaymentIntentId": null,
  "checkoutUrl": "https://checkout.stripe.com/...",
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>",
  "paidAt": null
}
```

## Notes
- Payment confirmation is driven by the Stripe webhook (`checkout.session.completed`).
- Inventory is decremented only after a successful payment.
- Firestore rejects `undefined`; omit fields or use `null`.
