# Backend Operations

## Admin claims

Run claim changes only from a trusted environment with the Firebase Admin service-account variables configured:

```sh
npm run admin:claim -- admin@example.com grant
npm run admin:claim -- admin@example.com revoke
```

The account must have a verified email. The command revokes existing refresh tokens; the user must sign in again to receive the updated claim.

## Vendor product privacy cleanup

The product privacy migration scans in pages and defaults to a dry run:

```sh
node migrations/removeVendorProductPrivateFields.js
node migrations/removeVendorProductPrivateFields.js --apply
```

Review the dry-run count before using `--apply` with production credentials. It deletes only `vendorAddress`, `vendorGstin`, and `vendorState` fields from public product documents; private vendor profiles remain the source for future checkout invoice/tax snapshots.