# Temporary Credentials (STS)

UFDS supports temporary security credentials for AWS STS (Security Token Service)
compatibility. These credentials have a limited lifespan and automatically expire.

## Overview

UFDS supports two types of access key credentials:

### Permanent Credentials

Standard access keys that remain valid until explicitly deleted. These credentials have:

- **accesskeyid** - The access key identifier
- **accesskeysecret** - The secret key
- **status** - One of: Active, Inactive, Expired
- **created** - Timestamp of creation
- **updated** - Timestamp of last update
- **description** - Optional description (max 150 characters)

### Temporary Credentials

Time-limited credentials issued through Security Token Service (STS) operations such as
AssumeRole. Temporary credentials include all permanent credential attributes plus:

- **credentialtype** - Set to "temporary" (vs "permanent")
- **sessiontoken** - Required session token for authentication
- **expiration** - Required ISO 8601 timestamp when credential expires
- **principaluuid** - Required UUID of the principal assuming the role
- **assumedrole** - Optional role ARN that was assumed

## Schema and Validation

Temporary credentials have strict validation enforced by `schema/accesskey.js`:

### Required Fields for Temporary Credentials

1. **Session Token** - The `sessiontoken` attribute must be present
2. **Expiration** - The `expiration` attribute must be:
   - A valid ISO 8601 timestamp
   - In the future (for add/modify operations)
   - Allowed to be in the past only for delete operations
3. **Principal UUID** - The `principaluuid` must identify the assuming principal
4. **Credential Type** - Must be set to "temporary"

### Read-Only Attributes

The following attributes cannot be modified after creation:
- `accesskeyid`
- `accesskeysecret`
- `created`

### Example Temporary Credential Entry

```ldif
dn: accesskeyid=AKIAIOSFODNN7EXAMPLE, uuid=b4629943-0..., ou=users, o=smartdc
objectclass: accesskey
accesskeyid: AKIAIOSFODNN7EXAMPLE
accesskeysecret: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
status: Active
credentialtype: temporary
sessiontoken: AQoDYXdzEJr...EXAMPLE
expiration: 2025-12-23T14:30:00.000Z
principaluuid: b4629943-0470-4ae0-94f5-5f3e165f1f50
assumedrole: arn:aws:iam::123456789012:role/DemoRole
created: 2025-12-22T12:30:00.000Z
updated: 2025-12-22T12:30:00.000Z
```

## Expiration Enforcement

Mahi enforces expiration of temporary credentials during request authentication.

The `/aws-auth` endpoint retrieves credential metadata from Redis without checking
expiration. During SigV4 signature verification in `mahi/lib/server/sigv4.js`, Mahi
checks if `expiration < now` and rejects expired credentials.

**Error Response:**
- HTTP Status: `403 Forbidden`
- Error Code: `InvalidSignature`
- Message: `"Temporary credential expired"` or `"Credential expired"`

Session token expiration is validated in `mahi/lib/server/session-token.js` with
message `"Session token has expired"`.

**Tests:** See `mahi/test/integration/auth-flow-complete.test.js`,
`mahi/test/sts-token-validation.test.js`, and `mahi/test/endpoint-aws-verify.test.js`.

## Automatic Cleanup

Expired temporary credentials are automatically cleaned up by UFDS to prevent
accumulation of stale entries in the directory. The cleanup job runs periodically
and removes credentials where `expiration <= now`.

### Cleanup Process Overview

The cleanup is performed by `lib/cleanup-expired-credentials.js` and follows this
workflow:

1. **Lock Acquisition** - Attempts to acquire an exclusive file-based lock at
   `/var/run/ufds-cleanup-expired-credentials.lock` to prevent concurrent execution

2. **Stale Lock Detection** - If a lock exists, checks if the process is still running:
   - If the process is dead, removes the stale lock and retries
   - If the process is alive, exits immediately to avoid conflicts

3. **Batch Processing** - Searches for and deletes expired credentials in batches:
   - Each batch finds up to 1000 expired credentials using LDAP search
   - Filter: `(&(objectclass=accesskey)(credentialtype=temporary)(expiration<=NOW))`
   - Deletions are performed with concurrency limit of 5 to avoid overwhelming Moray
   - Continues processing batches until no expired credentials remain

4. **Lock Release** - Always releases the lock on completion, error, or signal
   (SIGINT/SIGTERM)

### Lock Management

The cleanup process uses file-based locking with the following features:

- **Atomic Lock Creation** - Uses `O_EXCL` flag for atomic file creation
- **Process Verification** - Stores PID in lock file and verifies process is running
- **Stale Lock Removal** - Automatically removes locks from dead processes
- **Signal Handling** - Releases lock on SIGINT and SIGTERM
- **Exit Handler** - Ensures lock is released on normal process exit

The lock file path is `/var/run/ufds-cleanup-expired-credentials.lock` by default but
can be customized when calling the cleanup function programmatically.

### Batch Processing Details

To handle large numbers of expired credentials efficiently:

- **Batch Size**: 1000 credentials per batch
- **Concurrency**: 5 parallel deletions per batch
- **Rate Limiting**: Prevents overwhelming Moray with too many concurrent operations
- **Iterative Processing**: Continues until no expired credentials remain

This approach ensures the cleanup can handle thousands of expired credentials without
impacting system performance.

## Manual Cleanup Tool

A CLI tool is provided for manually triggering cleanup of expired credentials.

### Location

```
/opt/smartdc/ufds/bin/cleanup-expired-creds
```

### Usage

```bash
./bin/cleanup-expired-creds [-c config_file] [-d] [-h]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --config` | Path to config file (default: `etc/config.coal.json`) |
| `-d, --debug` | Enable debug logging (shows each credential deleted) |
| `-h, --help` | Show help message |

### Examples

**Basic cleanup (production config):**
```bash
cd /opt/smartdc/ufds
./bin/cleanup-expired-creds -c etc/config.json
```

**With debug output to see each deletion:**
```bash
./bin/cleanup-expired-creds -c etc/config.json -d
```

**Using COAL development config:**
```bash
./bin/cleanup-expired-creds -c etc/config.coal.json
```

### Sample Output

Normal output:
```json
{"level":30,"msg":"Starting expired credentials cleanup"...}
{"level":30,"msg":"Connected to UFDS, running cleanup..."...}
{"level":30,"count":994,"msg":"Found expired temporary credentials to delete"...}
{"level":30,"deleted":994,"msg":"Successfully deleted expired credentials"...}
{"level":30,"msg":"Cleanup completed successfully"...}
```

Debug output (with `-d` flag) includes each deletion:
```json
{"level":20,"dn":"accesskeyid=abc123..., uuid=user-uuid, ou=users, o=smartdc",
 "accesskeyid":"abc123...","expiration":"2025-11-26T17:00:00.000Z",
 "msg":"Deleting expired temporary credential"...}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - all expired credentials deleted |
| 1 | Failure - connection error or some deletions failed |

## Programmatic API

The cleanup module can be used programmatically in your application:

```javascript
var cleanup = require('./lib/cleanup-expired-credentials');

// Run cleanup once
cleanup.cleanupExpiredCredentials(ufdsClient, log, function(err) {
    if (err) {
        log.error({err: err}, 'Cleanup failed');
        return;
    }
    log.info('Cleanup completed successfully');
});
```

### Function Signature

```javascript
cleanupExpiredCredentials(ufdsClient, log, callback, lockPath)
```

**Parameters:**
- `ufdsClient` (Object) - Connected LDAP client instance
- `log` (Object) - Bunyan logger instance
- `callback` (Function) - Callback function `(err)` called on completion
- `lockPath` (String, optional) - Custom lock file path (defaults to
  `/var/run/ufds-cleanup-expired-credentials.lock`)

**Return Value:**
- None (results returned via callback)

### Error Handling

The callback receives an error in these cases:
- Lock is held by another process: `Error: Another cleanup process is already running`
- LDAP search failure: Error propagated from search operation
- Deletion failures: `Error: Failed to delete N credentials` (where N is the count)

## Monitoring and Logging

The cleanup process provides comprehensive structured logging:

### Successful Cleanup

```json
{"level":30,"pid":12345,"lockPath":"/var/run/ufds-cleanup-expired-credentials.lock","msg":"Lock acquired"}
{"level":30,"batch":1,"filter":"(&(objectclass=accesskey)(credentialtype=temporary)(expiration<=2025-12-22T12:00:00.000Z))","msg":"Searching for expired temporary credentials"}
{"level":30,"batch":1,"count":500,"msg":"Found expired temporary credentials to delete"}
{"level":30,"batch":1,"batchDeleted":500,"batchFailed":0,"totalDeleted":500,"totalFailed":0,"msg":"Batch cleanup completed"}
{"level":30,"batches":3,"totalDeleted":2500,"totalFailed":0,"msg":"Cleanup completed all batches"}
{"level":30,"lockPath":"/var/run/ufds-cleanup-expired-credentials.lock","msg":"Lock released"}
```

### Lock Contention

```json
{"level":30,"lockPath":"/var/run/ufds-cleanup-expired-credentials.lock","pid":12345,"msg":"Lock held by running process, exiting"}
{"level":30,"msg":"Another cleanup process is already running, exiting"}
```

### Stale Lock Removal

```json
{"level":30,"lockPath":"/var/run/ufds-cleanup-expired-credentials.lock","stalePid":99999,"msg":"Removing stale lock from dead process"}
```

### Deletion Failures

```json
{"level":50,"err":{"code":"ECONNREFUSED"},"dn":"accesskeyid=..., uuid=..., ou=users, o=smartdc","msg":"Failed to delete expired credential"}
{"level":30,"batch":1,"batchDeleted":498,"batchFailed":2,"totalDeleted":498,"totalFailed":2,"msg":"Batch cleanup completed"}
```

## Scheduling

For production deployments, schedule the cleanup to run periodically using cron.
The lock mechanism ensures that overlapping executions are safely prevented.

### Cron Example

```bash
# Run cleanup every hour
0 * * * * /opt/smartdc/ufds/bin/cleanup-expired-creds -c /opt/smartdc/ufds/etc/config.json >> /var/log/ufds-cleanup.log 2>&1
```

## Troubleshooting

### "Moray failure: unable to acquire backend connection"

This occurs when too many parallel operations overwhelm Moray. The cleanup tool
uses rate limiting (5 concurrent deletes) to prevent this. If you still see this
error, Moray may be under heavy load from other operations.

### No credentials found

If no expired credentials are found, either:
- All temporary credentials are still valid (not yet expired)
- No temporary credentials exist in the system
- Previous cleanup already removed them

### Permission denied

Ensure the config file has correct `rootDN` and `rootPassword` for UFDS bind.
